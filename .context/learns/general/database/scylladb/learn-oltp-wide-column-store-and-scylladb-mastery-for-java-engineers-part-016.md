# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-016.md

# Part 016 — Compaction Strategies: STCS, LCS, TWCS, ICS, dan Amplification Trade-offs

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `016`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami compaction sebagai mesin lifecycle SSTable: Size-Tiered Compaction Strategy (STCS), Leveled Compaction Strategy (LCS), Time-Window Compaction Strategy (TWCS), Incremental Compaction Strategy (ICS), read/write/space amplification, tombstone garbage collection, TTL-heavy workloads, dan cara memilih strategi per table.

---

## 0. Posisi Part Ini dalam Seri

Part 015 membahas:

```text
DELETE
TTL
tombstones
gc_grace_seconds
zombie data
repair
```

Part ini membahas mesin yang membuat storage LSM tetap sehat:

```text
compaction
```

Dalam LSM-style storage engine, write cepat karena data tidak selalu di-update in-place.

Write path:

```text
commitlog -> memtable -> flush -> SSTable
```

Setiap flush menghasilkan SSTable immutable baru.

Jika tidak ada compaction:

```text
SSTable count naik terus
old values tetap ada
tombstones menumpuk
read harus mengecek banyak files
disk usage membengkak
```

Compaction adalah proses background untuk menggabungkan, menyusun ulang, dan membersihkan SSTables.

---

## 1. Apa Itu Compaction?

Compaction menggabungkan beberapa SSTable menjadi SSTable baru.

Simplified:

```text
SSTable A + SSTable B + SSTable C
  -> Compaction
  -> SSTable D
```

Saat compaction:

- versi lama data bisa dibuang jika tertutup versi baru,
- tombstone bisa menghapus data lama,
- tombstone yang sudah aman bisa dipurge,
- jumlah SSTable bisa berkurang,
- data bisa diorganisasi agar read lebih efisien.

ScyllaDB docs describe compaction as a background process that reorganizes SSTables to reduce read, write, and space amplification; ScyllaDB implements multiple strategies including STCS, LCS, TWCS, and ICS.

---

## 2. Kenapa Compaction Diperlukan?

Karena LSM menukar biaya write sekarang dengan biaya maintenance nanti.

Tanpa compaction:

```text
write cepat sekarang
read lambat nanti
disk penuh nanti
tombstone menumpuk nanti
```

Compaction membayar “hutang” yang dibuat oleh write path.

### 2.1 Lifecycle

```text
write mutation
  -> memtable
  -> flush SSTable 1
more writes
  -> flush SSTable 2
more writes
  -> flush SSTable 3
read key
  -> maybe check SSTable 1,2,3
compaction
  -> merge SSTables
  -> read checks fewer files
```

---

## 3. Three Amplifications

Compaction strategy selalu trade-off di antara tiga amplification.

### 3.1 Read Amplification

Berapa banyak SSTable/data blocks yang harus dibaca untuk satu logical read.

High read amplification:

```text
read key harus cek banyak SSTables
```

Causes:

- banyak SSTables,
- overlapping ranges,
- tombstones,
- updates spread across files.

### 3.2 Write Amplification

Berapa kali data ditulis ulang selama lifecycle.

High write amplification:

```text
logical data 1 GB akhirnya ditulis ulang berkali-kali oleh compaction
```

Causes:

- leveled compaction,
- frequent updates,
- many levels,
- aggressive compaction.

### 3.3 Space Amplification

Berapa banyak disk ekstra dipakai dibanding live data.

High space amplification:

```text
live data 10 TB
disk used 20 TB
```

Causes:

- obsolete versions,
- tombstones,
- compaction temporary space,
- snapshots,
- strategy behavior.

ScyllaDB docs explicitly frame compaction strategies as reducing read amplification, write amplification, and space amplification.

---

## 4. There Is No Best Strategy

Compaction is workload-specific.

Question bukan:

```text
Which compaction is best?
```

Question:

```text
For this table, which amplification do we need to minimize?
```

Examples:

```text
write-heavy append table:
  tolerate more read amplification? choose write-friendly strategy

read-heavy current-state table:
  reduce read/space amplification? maybe LCS/ICS depending workload/version

TTL time-series table:
  align expiration with time windows? TWCS

default/general ScyllaDB:
  ICS may be default/recommended in modern ScyllaDB deployments depending edition/version
```

Always validate against your ScyllaDB version/edition and workload.

---

## 5. Strategy Overview

| Strategy | Main Idea | Strength | Weakness |
|---|---|---|---|
| STCS | compact similarly sized SSTables | write-friendly, simple | higher read/space amp under updates |
| LCS | organize SSTables into levels with limited overlap | lower read/space amp | higher write amp |
| TWCS | compact by time windows | good for TTL/time-series | poor if late/out-of-window writes |
| ICS | incremental compaction with SSTable runs/fragments | better disk utilization, balanced trade-off | version/edition/config considerations |

ScyllaDB stable docs list STCS, LCS, TWCS, and ICS in compaction strategy documentation.

---

## 6. Size-Tiered Compaction Strategy (STCS)

STCS groups SSTables of similar size and compacts them.

Simplified:

```text
When there are enough similar-sized SSTables:
  compact them into a larger SSTable
```

ScyllaDB docs describe STCS as triggered when the system has enough, four by default, similarly sized SSTables.

### 6.1 STCS Mental Model

```text
small SSTables merge into medium SSTables
medium SSTables merge into large SSTables
large SSTables merge into larger SSTables
```

This is similar to size tiers.

### 6.2 STCS Strengths

- good write throughput,
- relatively low write amplification,
- simple,
- good for append-heavy workloads,
- good when reads are mostly recent or cache-friendly,
- good when updates/deletes are not too heavy.

### 6.3 STCS Weaknesses

- more overlapping SSTables,
- higher read amplification,
- higher space amplification under updates,
- old overwritten data may stay longer,
- large compactions can need significant temporary disk,
- tombstones may linger if not compacted with shadowed data.

### 6.4 Good Fit

```text
write-heavy append workloads
large sequential ingest
low update churn
read patterns tolerate checking more SSTables
```

### 6.5 Bad Fit

```text
read-heavy point lookup with frequent updates
strict low read amplification
tables with many overwrites/deletes
limited disk headroom
```

---

## 7. Leveled Compaction Strategy (LCS)

LCS organizes SSTables into levels.

Goal:

```text
reduce read amplification and space amplification by limiting overlap
```

Simplified:

```text
L0 may overlap
L1, L2, ... have constrained non-overlapping token ranges
```

A point read checks fewer SSTables per level.

### 7.1 LCS Strengths

- lower read amplification,
- lower space amplification,
- good for read-heavy workloads,
- good for update-heavy point lookup compared to STCS,
- more predictable reads.

### 7.2 LCS Weaknesses

- higher write amplification,
- more compaction IO,
- can be costly for write-heavy workloads,
- needs sufficient disk/IO headroom,
- if compaction falls behind, benefits degrade.

ScyllaDB’s compaction-series material describes LCS as solving STCS space amplification but introducing write amplification.

### 7.3 Good Fit

```text
read-heavy table
point lookups
frequent updates to same keys
low-latency read requirement
storage efficiency important
```

### 7.4 Bad Fit

```text
very high write throughput
large append-only ingest
TTL time-windowed data
limited IO headroom for compaction
```

---

## 8. Time-Window Compaction Strategy (TWCS)

TWCS is designed for time-series workloads.

It groups SSTables by time window and compacts within each window.

ScyllaDB docs describe TWCS as designed for time-series workloads and compacting SSTables within each time window using size-tiered compaction.

### 8.1 TWCS Mental Model

```text
Current time window:
  new SSTables compacted actively

Old closed windows:
  mostly immutable
  eventually expire/drop if TTL aligned
```

### 8.2 TWCS Strengths

- good for time-series data,
- works well with TTL,
- old windows become stable,
- expired windows can be easier to purge,
- reduces compaction work on old immutable data.

### 8.3 TWCS Weaknesses

- late writes to old windows can hurt assumptions,
- multiple TTL values reduce effectiveness,
- not ideal for update-heavy non-time data,
- queries across many windows still fan out,
- wrong window size can hurt.

ScyllaDB TTL docs recommend considering TWCS when using TTL, and compaction docs warn that single TTL value per table is strongly recommended because multiple TTLs can make purging expired data inefficient.

### 8.4 Good Fit

```text
time-series append
fixed TTL
writes mostly current time
queries mostly recent/bounded windows
old data rarely updated
```

### 8.5 Bad Fit

```text
random updates across old time windows
many TTL values
non-time-series current-state table
late arrivals are common and unbounded
```

---

## 9. Incremental Compaction Strategy (ICS)

ICS is ScyllaDB-specific/ScyllaDB Enterprise-origin compaction strategy designed to improve space utilization while balancing read/write amplification.

ScyllaDB docs list Incremental Compaction Strategy among supported strategies. ScyllaDB system requirements docs say to use default ICS unless you clearly understand another strategy is better, and give recommended/minimum free disk guidance per strategy.

### 9.1 ICS Mental Model

ICS tries to avoid large temporary space overhead associated with STCS while keeping amplification trade-offs favorable.

ScyllaDB’s ICS material describes replacing increasingly large compacted SSTables with sorted runs of SSTable fragments, borrowing concepts from LCS.

### 9.2 ICS Strengths

- better disk utilization,
- balanced read/write/space amplification,
- useful default in modern ScyllaDB deployments,
- mitigates temporary space pressure,
- can be good for general workloads.

### 9.3 ICS Considerations

- verify availability/default for your ScyllaDB edition/version,
- understand operational tooling,
- tombstone GC behavior has strategy-specific details,
- do not assume ICS eliminates need for good data model,
- still monitor compaction backlog and amplification.

### 9.4 ICS and Tombstone GC

ScyllaDB docs on efficient tombstone garbage collection in ICS explain that droppable tombstones cannot be purged unless compacted with the data they shadow; the docs discuss mechanisms for timely purge.

Takeaway:

```text
Even with advanced compaction, tombstone cleanup depends on compaction meeting shadowed data.
```

---

## 10. Default Strategy Caveat

Do not blindly copy old Cassandra defaults.

ScyllaDB versions/editions may differ in default strategy and recommendations.

Docs may recommend ICS as default in modern ScyllaDB deployments, while older ScyllaDB/Cassandra-style examples may use STCS.

Production rule:

```text
Check your ScyllaDB version docs and cluster defaults.
Choose per table, not by folklore.
```

---

## 11. Compaction Options in CQL

Example:

```sql
CREATE TABLE events_by_device_hour (
    tenant_id uuid,
    device_id uuid,
    bucket_hour timestamp,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, device_id, bucket_hour), event_time, event_id)
) WITH compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_unit': 'HOURS',
    'compaction_window_size': '1'
};
```

Alter:

```sql
ALTER TABLE ks.table_name
WITH compaction = {
    'class': 'LeveledCompactionStrategy'
};
```

Changing compaction affects future compaction behavior, but existing SSTables may need time/compaction to reorganize.

Do not change compaction in production without testing and operational plan.

---

## 12. Choosing Strategy by Workload

### 12.1 Append-Only Event Log

Characteristics:

```text
mostly inserts
few updates/deletes
read recent/range
maybe long retention
```

Options:

- STCS/ICS for general append,
- TWCS if time-windowed with TTL,
- version bucket event log maybe ICS/STCS if no TTL.

### 12.2 Current-State Lookup

Characteristics:

```text
same row updated
point reads
low latency
small row
```

Options:

- LCS/ICS may be attractive,
- avoid STCS if update-heavy and read amplification hurts.

### 12.3 TTL Time-Series

Characteristics:

```text
append by time
fixed TTL
old data expires
mostly current writes
```

Options:

- TWCS often natural.

### 12.4 Derived Queue View

Characteristics:

```text
inserts/deletes
state changes
tombstones
bounded reads
```

Options:

- depends on churn.
- data model often more important than strategy.
- avoid tombstone-heavy design first.

### 12.5 Large Mutable Collection/Document

Bad fit regardless of compaction.

Fix data model.

---

## 13. STCS vs LCS vs TWCS vs ICS Cheat Sheet

| Workload Question | Likely Direction |
|---|---|
| Write-heavy append, little update | STCS/ICS |
| Read-heavy point lookup, updates | LCS/ICS |
| Time-series with fixed TTL | TWCS |
| Need high disk utilization | ICS |
| Many late writes to old windows | avoid naive TWCS |
| Many TTL values mixed | avoid TWCS assumptions |
| Very limited disk headroom | avoid STCS large temp overhead; consider ICS/LCS with ops |
| Unclear modern ScyllaDB default | check docs; often ICS default/recommended |

---

## 14. Compaction and Disk Headroom

Compaction needs disk space.

During compaction:

```text
input SSTables still exist
output SSTable being written
then old inputs removed
```

Temporary disk usage rises.

ScyllaDB system requirements docs provide recommended/minimum free disk guidelines by compaction strategy and state that maintaining free disk space is required for service availability; the same table notes ICS can target higher disk utilization than STCS/LCS/TWCS.

Takeaway:

```text
Do not run ScyllaDB near full disk.
Compaction needs room to breathe.
```

---

## 15. Space Amplification Examples

### 15.1 STCS

Can have high temporary space overhead due to large compactions.

Example:

```text
compacting 500 GB input
needs output space before deleting input
```

### 15.2 LCS

Lower steady-state space amp but higher write amp.

### 15.3 TWCS

Old expired windows may be dropped efficiently if TTL/window aligned.

### 15.4 ICS

Designed to improve disk utilization by avoiding some large temporary overhead.

---

## 16. Read Amplification Examples

### STCS

Many overlapping SSTables:

```text
read key might check many files
```

### LCS

Limited overlap:

```text
read checks fewer SSTables
```

### TWCS

If query targets current/recent windows:

```text
read checks SSTables in relevant windows
```

If query spans many windows:

```text
fanout across windows
```

### ICS

Balanced depending workload and implementation.

---

## 17. Write Amplification Examples

### STCS

Relatively low write amp.

### LCS

Higher because data can be rewritten across levels.

### TWCS

Can be write-friendly within active windows.

### ICS

Designed to avoid high write amp while improving space utilization.

Again:

```text
measure on your workload.
```

---

## 18. Tombstone Garbage Collection

Tombstone purge requires:

```text
tombstone past gc grace / eligible
compaction with shadowed data
strategy allows relevant SSTables to meet
```

If tombstone and shadowed data never compact together, tombstone remains.

ScyllaDB ICS tombstone GC docs emphasize that droppable tombstones cannot be purged unless compacted with the data they shadow.

Compaction strategy affects how quickly tombstone debt is paid.

---

## 19. TWCS and Tombstones

TWCS works well when:

```text
data in a window expires together
```

Example:

```text
bucket by day
TTL 30 days
compaction window day
```

Old window can eventually be dropped/purged efficiently.

Bad:

```text
same table has TTL 1 hour and TTL 1 year
```

SSTables may contain mixed expiry times.

Bad:

```text
late writes constantly update old windows
```

Old windows stay active and compaction assumptions weaken.

---

## 20. LCS and Tombstones

LCS can reduce read amp, but tombstone purge may still require compaction across levels.

Under update/delete-heavy workloads, LCS may help point reads but write amp rises.

Use when read latency matters enough to pay compaction IO.

---

## 21. STCS and Tombstones

STCS may delay tombstone purge because large old SSTables compact less frequently.

For delete-heavy/update-heavy tables, tombstones may remain and hurt reads.

Manual/major compaction can be tempting but dangerous if not understood.

Do not solve tombstone-heavy STCS table only with manual compaction; fix data model/TTL/strategy.

---

## 22. ICS and Tombstones

ICS includes specific tombstone GC considerations.

Docs discuss efficient tombstone GC because droppable tombstones must meet shadowed data; ICS has mechanisms to address timely purge.

Still:

```text
bad TTL/delete model can overwhelm any strategy.
```

---

## 23. Major Compaction

Major compaction compacts many/all SSTables into fewer SSTables.

It can:

- reduce SSTable count,
- purge tombstones if safe,
- free space after compaction,
- improve reads.

But it can also:

- consume huge IO/CPU,
- require large temporary disk,
- hurt foreground latency,
- produce very large SSTables,
- disrupt normal compaction balance.

Use only with operational guidance.

Application engineer should know:

```text
manual compaction is not normal application-level fix.
```

---

## 24. Compaction Backlog

Compaction backlog means writes create SSTables faster than compaction can process.

Symptoms:

- SSTable count grows,
- read latency rises,
- disk usage rises,
- tombstone debt rises,
- compaction pending tasks high,
- write latency can rise due resource pressure,
- node/shard CPU/IO high.

Causes:

- write rate too high,
- disk too slow,
- compaction throttled too much,
- wrong strategy,
- large partitions,
- tombstone-heavy workload,
- insufficient nodes,
- too many tables,
- repair/streaming competing.

ScyllaDB configuration docs note that faster insert rates require faster compaction to keep SSTable count down, and mention compaction throughput control.

---

## 25. Compaction and Foreground Latency

Compaction is background, but not free.

It consumes:

- CPU,
- disk read/write IO,
- memory buffers,
- scheduling capacity,
- cache effects.

If compaction competes with foreground reads/writes, p99 can rise.

ScyllaDB’s shard-per-core scheduling helps isolate/control work, but physical resources are finite.

Operationally:

```text
compaction is part of write cost, paid later.
```

---

## 26. Compaction and Tablets/Shards

Compaction happens within ScyllaDB’s shard-aware architecture.

Each shard owns data and performs compaction for its data.

Hot shard/partition can create localized compaction pressure.

Tablets and data distribution affect where data lives, but compaction load still follows data/write patterns.

Bad partitioning can cause:

```text
one shard has huge compaction backlog
others idle
```

Compaction strategy cannot fully fix hot partition design.

---

## 27. Compaction and Large Partitions

Large partitions hurt compaction because:

- large clustering ranges,
- many updates/tombstones in one partition,
- large row index/metadata,
- compaction has to process big chunks,
- read path still may scan huge range.

Changing compaction strategy may reduce symptoms but not core issue.

Fix:

- bucket partition,
- split large entity,
- reduce tombstones,
- archive old data,
- rebuild table.

---

## 28. Compaction and Collections

Large collections create many cells/tombstones.

Compaction must process them.

If collection is repeatedly overwritten:

```text
many tombstones
```

Compaction load rises.

Fix data model:

```text
child table with bounded partition
```

not merely compaction tuning.

---

## 29. Compaction Strategy Per Table

Different tables can and should use different strategies.

Example regulatory platform:

| Table | Workload | Strategy Candidate |
|---|---|---|
| case_current_by_id | point read/update | ICS/LCS |
| case_events_by_case_version_bucket | append audit | ICS/STCS |
| notifications_by_user_day | time feed TTL | TWCS/ICS depending TTL/read |
| login_attempts_by_user_day | TTL time-series | TWCS |
| command_idempotency_by_id | TTL point lookup | ICS/TWCS depending shape |
| open_cases_by_assignee_day_bucket | derived queue churn | depends; model first |
| metrics_by_device_minute | time-series TTL | TWCS |

Do not use one strategy for every table by habit.

---

## 30. CQL Examples

### 30.1 STCS

```sql
WITH compaction = {
    'class': 'SizeTieredCompactionStrategy'
}
```

### 30.2 LCS

```sql
WITH compaction = {
    'class': 'LeveledCompactionStrategy'
}
```

### 30.3 TWCS

```sql
WITH compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_unit': 'DAYS',
    'compaction_window_size': '1'
}
```

### 30.4 ICS

```sql
WITH compaction = {
    'class': 'IncrementalCompactionStrategy'
}
```

Exact option support and defaults depend on ScyllaDB version/edition. Always confirm with official docs for your version.

---

## 31. TWCS Window Size

Window size should match:

- write pattern,
- query pattern,
- TTL,
- bucket size,
- late arrival behavior.

Examples:

```text
TTL 7 days, bucket day, queries by day:
  TWCS window day may fit

TTL 1 hour, high write:
  hour window may fit

TTL 1 year:
  larger windows may be appropriate
```

Too small:

- many windows/SSTables,
- overhead.

Too large:

- expired/live data mixed longer,
- less efficient purge.

---

## 32. TTL Table Design With TWCS

Good:

```sql
CREATE TABLE login_attempts_by_user_day (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    attempt_time timestamp,
    attempt_id uuid,
    success boolean,
    PRIMARY KEY ((tenant_id, user_id, bucket_day), attempt_time, attempt_id)
) WITH default_time_to_live = 7776000
  AND compaction = {
      'class': 'TimeWindowCompactionStrategy',
      'compaction_window_unit': 'DAYS',
      'compaction_window_size': '1'
  };
```

Assumptions:

- rows expire after same TTL,
- writes mostly current day,
- queries recent days,
- old buckets not updated heavily.

If assumptions false, revisit.

---

## 33. Current-State Table With LCS/ICS

Current state:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id))
) WITH compaction = {
    'class': 'LeveledCompactionStrategy'
};
```

May be useful if:

- point reads frequent,
- updates overwrite same rows,
- read amplification matters.

But if write rate high, LCS write amplification may hurt.

ICS may be a balanced/default alternative.

Measure.

---

## 34. Append Event Table With ICS/STCS

Event log:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
) WITH compaction = {
    'class': 'IncrementalCompactionStrategy'
};
```

If no TTL and mostly append, ICS/STCS may fit.

If time bucket + TTL, TWCS may fit.

If updates/deletes frequent, reconsider event log immutability.

---

## 35. Materialized Views and Compaction

Materialized views have their own storage and compaction.

ScyllaDB materialized view docs state the default compaction strategy is used unless explicitly set, and compaction strategy for a view can be set during creation or altered later.

Implication:

```text
base table compaction != view compaction necessarily
```

If MV has different access/write pattern, choose accordingly.

---

## 36. Indexes and Compaction

Secondary indexes have storage structures too.

They can add compaction/write amplification.

If index table/storage is tombstone-heavy or high-update, compaction issues multiply.

Part 017 covers indexes/MV.

For now:

```text
Every additional storage structure has compaction lifecycle.
```

---

## 37. Monitoring Compaction

Monitor:

```text
pending compactions
compaction throughput
SSTable count
read latency
write latency
disk usage
tombstone warnings
space amplification
compaction errors
per-table compaction activity
per-shard compaction backlog
CPU/disk IO
```

Commands/tools may include:

- nodetool compactionstats,
- nodetool compactionhistory,
- ScyllaDB Monitoring dashboards,
- table metrics,
- logs.

ScyllaDB docs include nodetool compactionhistory for compaction operation history.

---

## 38. Symptoms by Strategy

### STCS Problems

```text
too many SSTables
read amplification
disk temporary pressure
tombstones linger
large compactions
```

### LCS Problems

```text
high write amplification
compaction cannot keep up
IO pressure
write p99 rises
```

### TWCS Problems

```text
late writes to old windows
too many windows
expired data not purged due TTL mix
queries span many windows
```

### ICS Problems

```text
strategy-specific tombstone GC/backlog issues
misunderstood defaults
still subject to bad data model
```

---

## 39. Choosing Strategy: Decision Tree

Ask:

```text
1. Is table primarily time-series with TTL?
   yes -> TWCS candidate

2. Are writes mostly current time window and TTL uniform?
   yes -> TWCS stronger candidate
   no -> be careful

3. Is table read-heavy point lookup with updates?
   yes -> LCS/ICS candidate

4. Is table write-heavy append with low update/delete?
   yes -> STCS/ICS candidate

5. Is disk utilization/headroom a key concern?
   yes -> ICS may be attractive

6. Is data model tombstone-heavy?
   fix model before strategy

7. Is workload mixed/unclear?
   default ICS/cluster recommendation may be best starting point
```

---

## 40. Compaction Strategy Matrix for Example Domain

### `case_current_by_id`

```text
small row
point read
conditional update
```

Candidate:

```text
ICS default or LCS if read amp matters and write rate moderate
```

### `case_events_by_case_version_bucket`

```text
append-only
no TTL
read by case/version bucket
```

Candidate:

```text
ICS/STCS
```

### `notifications_by_user_day`

```text
time feed
TTL 30d
some updates read_at maybe
```

Candidate:

```text
TWCS if TTL/time-window assumptions hold
or separate read state to reduce updates
```

### `command_idempotency_by_id`

```text
TTL point lookup
small row
random key
```

Candidate:

```text
ICS; TWCS less obvious because partition key not time-window unless modeled by day
```

### `login_attempts_by_user_day`

```text
time-series TTL
```

Candidate:

```text
TWCS
```

### `open_cases_by_assignee_day_bucket`

```text
derived list
deletes on close/reassign
```

Candidate:

```text
depends; reduce tombstone churn first
```

---

## 41. Compaction and Data Modeling Feedback Loop

If choosing compaction feels impossible, your table may be mixing workloads.

Bad mixed table:

```text
source audit no TTL
ephemeral notifications TTL
current state updates
search fields
```

Split:

```text
audit event table
notification feed TTL table
current state table
search projection
```

Compaction strategy should be coherent per table.

If one table needs STCS, LCS, and TWCS simultaneously, the table is probably wrong.

---

## 42. Compaction and Backfill

Backfill writes large historical data.

Risks:

- compaction backlog,
- disk pressure,
- read latency impact,
- old time windows written with TWCS,
- cache churn.

Backfill plan:

```text
throttle writes
monitor compaction
avoid peak hours
split by tenant/bucket
consider temporary strategy only with DBA guidance
repair/validate after
```

For TWCS, backfilling old timestamps can create old-window SSTables and affect purge behavior.

---

## 43. Compaction and Repair/Streaming

Repair/streaming competes for IO/CPU/network.

If compaction backlog already high, repair/streaming can worsen p99.

Coordinate:

- compaction,
- repair,
- tablet movement,
- backup,
- backfill,
- bulk loading.

Operational windows matter.

---

## 44. Compaction and Bulk Loading

Bulk loading SSTables can bypass normal write path and introduce SSTables directly.

Need consider:

- target compaction strategy,
- SSTable size,
- repair/consistency,
- compaction after load,
- disk headroom,
- token/tablet distribution.

Bulk loading deep dive part 022/ops parts.

For now:

```text
bulk load is not just faster writes; it changes compaction workload.
```

---

## 45. Manual Tuning Risks

Compaction parameters are powerful.

Changing:

- thresholds,
- window size,
- strategy,
- tombstone GC options,
- throughput throttle,

can improve or harm system.

Application engineer should collaborate with DB/SRE.

Before tuning:

```text
identify table/query
measure amplification
understand workload
test in staging
roll out gradually
monitor
have rollback plan
```

---

## 46. Java/Application Implications

Application behavior affects compaction.

Bad application patterns:

- writing nulls,
- updating full rows for tiny changes,
- overwriting large collections,
- high-churn derived deletes,
- unbounded TTL randomization,
- fanout writes to many tables,
- huge payload duplication,
- retry storms,
- backfill without throttle.

Good patterns:

- append immutable events,
- small current rows,
- bounded partitions,
- stable TTL per table,
- separate retention classes,
- validate-on-read for high-churn views,
- idempotent backfill with throttling,
- per-key rate limits.

Compaction is not only database setting. It is consequence of application write model.

---

## 47. Example Incident: Compaction Debt from TTL Feed

Scenario:

```text
notifications_by_user_day
TTL 30d
many users
read_at updated in same row
some notifications TTL 1d, some 30d, some no TTL
TWCS day window
```

Symptoms:

- disk usage high,
- tombstone warnings,
- read p99 high,
- compaction backlog.

Root causes:

- mixed TTL values,
- updates to old windows,
- read_at churn in same table,
- stale old ranges queried.

Fix:

- separate read state table,
- uniform TTL,
- reject queries beyond retention,
- rebuild table,
- choose compaction window aligned with TTL,
- monitor tombstone scan.

---

## 48. Example Incident: LCS Write Amplification

Scenario:

```text
case_current_by_id uses LCS
command workload increases 10x
same rows updated frequently
```

Symptoms:

- compaction IO high,
- write p99 rises,
- pending compactions,
- disk saturation.

Potential fixes:

- reduce update frequency,
- coalesce writes,
- move history to append table,
- evaluate ICS/default strategy,
- add capacity,
- tune compaction with SRE.

Do not assume LCS always improves performance.

---

## 49. Example Incident: STCS Read Amplification

Scenario:

```text
case_current_by_id uses STCS
frequent updates
point reads p99 rising
```

Symptoms:

- many SSTables,
- reads check many files,
- stale versions/tombstones,
- disk usage high.

Potential fixes:

- evaluate LCS/ICS,
- reduce full-row updates,
- fix mapper nulls,
- compact/rebuild under plan,
- monitor SSTable count.

---

## 50. Example Incident: TWCS Late Arrivals

Scenario:

```text
device readings by hour
TWCS hour windows
devices offline for 7 days then sync old readings
```

Symptoms:

- old windows receive writes,
- compaction old windows active again,
- expired data not purged as expected,
- read/compaction cost rises.

Potential fixes:

- lateness policy,
- write late data to quarantine/backfill path,
- bucket by ingest time + event_time column,
- separate late-arrival table,
- throttle offline sync.

---

## 51. Compaction Design Checklist

For every table:

```text
[ ] What is dominant workload: append, update, delete, TTL, read?
[ ] What is read pattern: point, range, latest, scan?
[ ] What is write rate?
[ ] Are updates overwriting same keys?
[ ] Are deletes/TTL frequent?
[ ] Is TTL uniform?
[ ] Are writes time-ordered?
[ ] Are late arrivals common?
[ ] What is acceptable read amplification?
[ ] What is acceptable write amplification?
[ ] What disk headroom exists?
[ ] What strategy is default for current ScyllaDB version?
[ ] Does table need TWCS/LCS/STCS/ICS explicitly?
[ ] Is compaction backlog monitored?
[ ] Can table be rebuilt if strategy wrong?
[ ] Is data model mixing incompatible lifecycles?
```

---

## 52. Common Misconceptions

### Misconception 1: “Compaction is only DBA concern.”

No. Application data model creates compaction workload.

### Misconception 2: “Compaction improves everything.”

No. It trades write IO for read/space benefits.

### Misconception 3: “LCS is always faster.”

Only for certain read/update patterns; it increases write amplification.

### Misconception 4: “TWCS is for any table with timestamp.”

No. It is for time-windowed workloads with compatible write/TTL patterns.

### Misconception 5: “TTL + TWCS means tombstones disappear immediately.”

No. Expiry, gc grace, compaction, and SSTable windows all matter.

### Misconception 6: “Manual compaction is safe cleanup.”

It can be expensive/disruptive. Use carefully.

### Misconception 7: “One compaction strategy per database is fine.”

Different tables have different lifecycles.

### Misconception 8: “Compaction can fix bad partition key.”

No. Hot/large partition design must be fixed at schema/application level.

---

## 53. Mental Model Compression

Remember:

```text
LSM write path creates SSTables.
Compaction merges SSTables.
Compaction pays storage debt.
Strategy decides which debt is paid first:
  read amplification
  write amplification
  space amplification
  tombstone debt
```

And:

```text
Compaction strategy is table-specific workload policy.
```

---

## 54. Summary

Compaction is central to ScyllaDB performance and storage health.

Key lessons:

1. Compaction merges SSTables and removes obsolete data/tombstones when safe.
2. Compaction controls read, write, and space amplification trade-offs.
3. STCS is write-friendly but can have read/space amplification.
4. LCS lowers read/space amplification but increases write amplification.
5. TWCS is designed for time-series/TTL workloads with time-windowed writes.
6. ICS is ScyllaDB-specific/default/recommended in modern deployments where applicable and improves disk utilization/balanced trade-offs.
7. TTL and compaction strategy must be designed together.
8. Multiple TTL values in one table can make expired data purge inefficient.
9. Tombstone purge requires compaction with shadowed data.
10. Compaction needs disk headroom.
11. Compaction backlog affects foreground latency.
12. Large partitions, collections, null writes, and high-churn deletes create compaction pain.
13. Different tables should use strategies aligned to their workload.
14. Changing compaction requires testing and operational plan.
15. Application behavior directly creates compaction workload.

---

## 55. Review Questions

1. Kenapa compaction dibutuhkan dalam LSM storage?
2. Apa itu read amplification?
3. Apa itu write amplification?
4. Apa itu space amplification?
5. Bagaimana STCS bekerja secara mental model?
6. Kapan STCS cocok?
7. Apa trade-off LCS?
8. Kapan LCS cocok?
9. Kenapa TWCS cocok untuk TTL time-series?
10. Kapan TWCS buruk?
11. Apa tujuan ICS?
12. Kenapa disk headroom penting untuk compaction?
13. Kenapa tombstone tidak selalu langsung purged setelah gc_grace?
14. Bagaimana multiple TTL values memengaruhi compaction?
15. Apa gejala compaction backlog?
16. Kenapa manual major compaction berisiko?
17. Bagaimana application mapper bisa memperburuk compaction?
18. Mengapa table dengan mixed lifecycles harus dipecah?
19. Apa strategy candidate untuk current-state table?
20. Apa strategy candidate untuk TTL login attempts table?

---

## 56. Practical Exercise

Gunakan domain regulatory case management.

Untuk setiap table berikut, pilih candidate compaction strategy dan jelaskan:

```text
1. case_current_by_id
2. case_events_by_case_version_bucket
3. notifications_by_user_day
4. login_attempts_by_user_day
5. command_idempotency_by_id
6. open_cases_by_assignee_day_bucket
7. case_counts_by_status_day
8. device_readings_by_device_minute
```

Untuk tiap table, tulis:

```text
dominant workload
read pattern
write/update/delete pattern
TTL?
late arrivals?
tombstone risk?
read amplification tolerance
write amplification tolerance
space amplification tolerance
candidate strategy
operational metrics
what would make you change strategy
```

---

## 57. Preview Part 017

Part berikutnya membahas:

```text
Secondary Indexes, Local Secondary Indexes, Materialized Views
```

Kita akan membahas:

- kenapa index bukan SQL index biasa,
- secondary index cost model,
- local secondary index,
- materialized view semantics,
- write amplification,
- read path,
- when to use explicit tables instead,
- Java/API implications,
- operational risk.

Part 016 menjelaskan storage lifecycle.

Part 017 menjelaskan alternate access paths yang dibangun di atas lifecycle tersebut.

---

# End of Part 016

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Deletes, TTL, Tombstones, gc_grace_seconds, dan Zombie Data</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-017.md">Part 017 — Secondary Indexes, Local Secondary Indexes, dan Materialized Views ➡️</a>
</div>

# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-023.md

# Failure Modes and Production Runbooks

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `023`  
> Fokus: failure modelling, incident response, diagnostic decision tree, dan runbook produksi untuk QuestDB/time-series systems  
> Target pembaca: Java software engineer / tech lead yang perlu mengoperasikan QuestDB sebagai bagian dari platform produksi

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun observability: apa yang harus dipantau, bagaimana membaca ingestion freshness, WAL lag, query latency, disk growth, dan table state.

Part ini naik satu level: **apa yang harus dilakukan ketika metrik itu menunjukkan masalah**.

Target part ini bukan membuat daftar error acak, tetapi membangun kemampuan berikut:

1. mengenali failure mode umum pada QuestDB/time-series workload;
2. membedakan symptom, cause, blast radius, dan mitigation;
3. membuat runbook yang bisa dipakai operator saat incident;
4. menghindari tindakan panik yang memperburuk keadaan;
5. mendesain aplikasi Java agar tidak memperbesar incident;
6. membangun mental model incident response untuk ingestion-heavy database.

Setelah part ini, kamu harus bisa menjawab:

```text
Apa arti WAL pending rows terus naik?
Apakah data hilang atau hanya belum query-visible?
Kapan harus throttle producer?
Kapan harus pause backfill?
Kapan harus resume WAL table?
Apa bedanya disk-full incident dengan query-storm incident?
Apa yang harus dicek sebelum restart QuestDB?
Bagaimana membedakan O3 storm dengan consumer overproduction?
Bagaimana mencegah satu bad producer merusak schema?
Bagaimana membuat runbook yang bisa dijalankan tim on-call tanpa menebak-nebak?
```

---

## 2. Mental Model: Incident = Pipeline State Tidak Seimbang

QuestDB dalam workload time-series biasanya berada di tengah pipeline:

```text
producers / devices / services
        ↓
ingestion gateway / Kafka consumer / Java app
        ↓
QuestDB WAL
        ↓
WAL apply
        ↓
native table storage
        ↓
query engine / materialized views / dashboard / API
```

Incident jarang hanya berarti “database down”. Lebih sering, satu stage lebih cepat/lambat/rusak dibanding stage lain.

Contoh:

```text
Producer lebih cepat dari WAL apply
→ WAL pending rows naik
→ query freshness tertinggal
→ dashboard tampak stale
→ user mengira data hilang
```

Atau:

```text
Dashboard menjalankan unbounded query
→ query workers/memory sibuk
→ ingestion masih diterima
→ query latency naik
→ API timeout
```

Atau:

```text
Bad producer mengirim field baru dinamis
→ schema pollution
→ row width membesar
→ storage growth naik
→ query scan makin mahal
```

Jadi incident response harus dimulai dari pertanyaan:

```text
Stage mana yang tidak seimbang?
```

Bukan langsung:

```text
Restart database.
```

---

## 3. Taxonomy Failure Mode QuestDB/TSDB

Kita kelompokkan failure mode menjadi beberapa keluarga.

```text
1. Availability failures
   - QuestDB process down
   - port inaccessible
   - pod crashloop
   - disk mount missing

2. Ingestion failures
   - producer cannot connect
   - rejected line protocol
   - schema/type mismatch
   - ingestion backlog
   - Java queue full

3. Durability/apply failures
   - WAL lag grows
   - table suspended
   - WAL apply cannot keep up
   - disk/kernel limit issue

4. Freshness failures
   - data accepted but not visible enough
   - materialized view stale
   - late data not represented in aggregate

5. Query failures
   - slow query
   - query timeout
   - memory blow-up
   - dashboard storm
   - bad API query shape

6. Storage failures
   - disk full
   - unexpected disk growth
   - too many files/partitions
   - insufficient compaction/conversion workspace

7. Data quality failures
   - duplicate rows
   - wrong timestamp
   - unit drift
   - symbol cardinality explosion
   - sparse/wide table pollution

8. Lifecycle failures
   - TTL misconfigured
   - retention violates policy
   - accidental partition drop
   - cold data query too slow

9. Operational/process failures
   - no backup validation
   - no runbook owner
   - no alert threshold rationale
   - undocumented producer contract
```

A strong production system does not pretend these cannot happen. It defines:

```text
for each failure mode:
  detection
  triage
  immediate mitigation
  recovery
  prevention
  owner
```

---

## 4. Golden Rule: Preserve Evidence Before Acting

During an incident, the fastest action is not always the safest action.

Before restart, delete, resume, truncate, or alter table, capture evidence:

```sql
-- High-level table health
SELECT * FROM tables();

-- WAL-specific status, use less frequently than tables()
SELECT * FROM wal_tables();

-- Partition state
SHOW PARTITIONS FROM table_name;

-- Recent freshness sample
SELECT max(timestamp) FROM table_name;

-- Disk-related OS check outside SQL
-- df -h
-- df -i
-- iostat / pidstat / vmstat depending environment
```

Why this matters:

```text
No evidence
→ no root cause
→ repeated incident
→ unsafe automation
```

Runbook discipline:

```text
capture first, mutate second
```

---

## 5. Incident 1: QuestDB Process Down or Unreachable

### 5.1 Symptom

```text
- health endpoint fails
- web console unavailable
- PGWire connection refused
- ILP HTTP/TCP connection refused
- Java client connection failures
- Kubernetes pod restarted/crashlooping
```

### 5.2 First Questions

```text
Is the process down, or only one endpoint unreachable?
Is the storage mount present?
Is disk full?
Was there config change?
Was there recent schema/backfill/query storm?
Is this one node or all nodes?
```

### 5.3 Triage

```bash
# process/container status
systemctl status questdb
# or
kubectl get pods
kubectl describe pod <questdb-pod>
kubectl logs <questdb-pod> --previous

# disk and inode
 df -h
 df -i

# network/ports
ss -lntp | grep -E '9000|9003|9009|8812'
```

QuestDB commonly exposes multiple interfaces. Do not assume all are down just because one is down.

```text
HTTP/Web Console/API: commonly 9000
Health: commonly 9003
ILP TCP: commonly 9009
PGWire: commonly 8812
```

### 5.4 Immediate Mitigation

If this is a single-node setup:

```text
1. Stop producer or make producer buffer/retry safely.
2. Check disk/mount before restart.
3. Capture previous logs.
4. Restart only after confirming storage path is correct.
5. Verify tables and freshness after restart.
```

If producers are Java services:

```text
- open circuit breaker after repeated failures
- buffer only within bounded limits
- publish to DLQ/replay topic if buffer full
- avoid infinite memory queue
```

### 5.5 Dangerous Actions

```text
- restarting repeatedly without checking disk full
- starting QuestDB with an empty/wrong volume mount
- deleting WAL or table directories manually
- disabling alerts because they are noisy
```

### 5.6 Recovery Validation

```sql
SELECT * FROM tables();
SELECT max(timestamp) FROM critical_table;
SELECT count(*) FROM critical_table WHERE timestamp > dateadd('m', -10, now());
```

Also validate externally:

```text
producer success rate
query API success rate
dashboard freshness
WAL pending rows
error logs
```

---

## 6. Incident 2: Disk Full

Disk full is one of the most dangerous TSDB incidents because time-series systems naturally grow fast.

### 6.1 Symptom

```text
- writes fail
- WAL table suspended
- WAL apply stops
- process errors mentioning no space left
- pod evicted due ephemeral storage
- query may still work for old data
- WAL pending rows grow
```

QuestDB documentation notes that WAL tables may become suspended due to conditions such as full disk or kernel limits, and recovery may involve resuming WAL from a specific transaction when segments are affected.

### 6.2 Triage

```bash
# capacity
 df -h
 df -i
 du -h --max-depth=1 <questdb-root>

# identify growth areas
 du -h --max-depth=2 <questdb-root>/db | sort -h | tail -50

# if containerized
 kubectl describe pod <pod>
 kubectl exec -it <pod> -- df -h
```

SQL checks:

```sql
SELECT * FROM tables();
SELECT * FROM wal_tables();
```

Look for:

```text
- suspended tables
- rising pending rows
- tables with unexpected size/growth
- materialized views consuming space
- partitions not aging out
```

### 6.3 Immediate Mitigation

Prioritize safe space recovery:

```text
1. Stop or throttle ingestion.
2. Pause backfill jobs.
3. Stop expensive materialized view refresh if applicable.
4. Increase disk if using cloud volume and possible.
5. Drop only clearly safe old partitions according to retention policy.
6. Do not manually delete random files from table/WAL directories.
```

Safer space recovery options:

```sql
-- If retention policy allows and partition boundaries are understood
ALTER TABLE table_name DROP PARTITION LIST '2025-01-01';
```

Or use configured TTL where appropriate rather than ad-hoc deletion.

### 6.4 Dangerous Actions

```text
- rm -rf inside QuestDB db directory
- deleting WAL segments manually
- dropping partitions without confirming retention/legal hold
- restarting into the same full disk condition repeatedly
- letting Java producers retry unbounded and amplify WAL backlog
```

### 6.5 Recovery

After space is restored:

```sql
SELECT * FROM tables();
SELECT * FROM wal_tables();
```

If table is suspended, use the documented recovery flow for resuming WAL. Do not guess transaction numbers casually.

### 6.6 Prevention

```text
- alert on disk projected time-to-full, not only % used
- capacity planning per table
- TTL aligned with partition granularity
- separate raw and rollup retention
- enforce producer schema/cardinality budget
- keep emergency free-space margin
- test restore and partition drop procedure
```

---

## 7. Incident 3: WAL Pending Rows / WAL Lag Growing

### 7.1 Symptom

```text
- writes appear accepted
- queries show stale data
- dashboard freshness lags
- wal pending rows continuously grow
- table_txn lags wal_txn
```

This is not necessarily data loss. It often means data is safely in WAL but not yet applied to table storage, so it is not query-visible.

### 7.2 Triage

```sql
SELECT * FROM tables();
SELECT * FROM wal_tables();
```

Look for:

```text
wal_txn - table_txn growing
wal_pending_row_count growing
table suspended
memory pressure
write throughput higher than apply throughput
```

Key question:

```text
Is WAL apply blocked, or merely slower than ingestion?
```

### 7.3 Common Causes

```text
- ingestion rate exceeds apply capacity
- large out-of-order workload
- historical replay mixed with live ingestion
- disk too slow
- table suspended
- row too wide
- too many partitions touched
- expensive materialized view refresh chain
- insufficient worker capacity
```

### 7.4 Immediate Mitigation

```text
1. Identify affected tables.
2. Stop/pause historical backfill first.
3. Throttle producer/consumer rate.
4. Separate live ingestion from late/backfill lanes.
5. Check disk latency and free space.
6. Check whether table is suspended.
7. Avoid restarting unless there is evidence restart helps.
```

Java-side action:

```java
// Pseudocode only
if (questdbWalLagTooHigh(table) || freshnessLagTooHigh(table)) {
    ingestionRateLimiter.reducePermits();
    backfillConsumer.pause();
    liveConsumer.keepRunningAtSafeRate();
}
```

### 7.5 Recovery Validation

Healthy trend:

```text
pending rows stop increasing
pending rows decrease
freshness lag decreases
table_txn catches up to wal_txn
query-visible max(timestamp) advances
```

### 7.6 Prevention

```text
- alert on derivative: lag growing continuously
- cap backfill throughput
- sort historical data by timestamp
- avoid touching many old partitions at once
- use dedup to make replay safe
- capacity test WAL apply, not only client send throughput
```

---

## 8. Incident 4: WAL Table Suspended

### 8.1 Symptom

```text
- one table stops applying WAL
- writes may continue into WAL or fail depending condition
- queries do not see new rows
- monitoring shows suspended state
- logs mention table suspended / cannot apply transaction
```

### 8.2 Causes

```text
- disk full
- kernel/file limit issue
- schema/type conflict
- corrupted/incomplete WAL segment after severe IO issue
- memory/disk needed for transaction apply unavailable
- operational interruption during critical write/apply path
```

### 8.3 Triage

```sql
SELECT * FROM tables() WHERE table_name = 'target_table';
SELECT * FROM wal_tables() WHERE name = 'target_table';
```

Then OS:

```bash
df -h
df -i
ulimit -n
journalctl -u questdb --since "1 hour ago"
```

### 8.4 Immediate Mitigation

```text
1. Stop or throttle producers for affected table.
2. Preserve logs and table/WAL status.
3. Fix underlying cause first: disk, inode, file limit, memory, schema conflict.
4. Only then attempt documented WAL resume procedure.
```

### 8.5 Resume Discipline

Do not treat `ALTER TABLE RESUME WAL` as a magic button.

Before resume:

```text
- identify table
- identify cause
- ensure enough disk/headroom
- ensure producer is not overwhelming apply again
- snapshot/backup if incident severity requires
```

After resume:

```text
- watch pending rows
- watch table_txn catching up
- validate row counts/freshness
- compare producer offsets if using Kafka
```

### 8.6 Prevention

```text
- disk time-to-full alert
- file descriptor/inode monitoring
- schema validation before ingest
- bounded backfill
- WAL status dashboard
- emergency throttle switch in ingestion service
```

---

## 9. Incident 5: O3 Storm / Late Data Overload

O3 means out-of-order data. QuestDB supports it, but it is not free.

### 9.1 Symptom

```text
- ingestion accepted but apply slows
- WAL lag grows
- disk IO increases
- CPU increases
- old partitions touched repeatedly
- partition split/squash metadata appears
- query freshness deteriorates
```

### 9.2 Causes

```text
- producer clocks wrong
- devices reconnect and replay historical data
- Kafka consumer replays old offsets into live table
- backfill unsorted by timestamp
- late lane not separated from live lane
- overly large partitions for late-write workload
```

### 9.3 Triage

Determine timestamp distribution of incoming data.

In ingestion gateway, log/metric:

```text
event_time_age_seconds = now - event_timestamp
```

Bucket it:

```text
0-10s
10s-1m
1m-10m
10m-1h
1h-1d
>1d
```

SQL/partition checks:

```sql
SHOW PARTITIONS FROM table_name;
SELECT max(timestamp), min(timestamp) FROM table_name;
```

### 9.4 Immediate Mitigation

```text
1. Pause backfill/replay first.
2. Route very late data to late lane or staging table.
3. Keep live ingestion running if possible.
4. Sort late data before ingesting.
5. Reduce late ingestion rate.
6. Validate producer clock skew.
```

### 9.5 Architecture Fix

Instead of:

```text
all events -> one live ingestion path -> QuestDB
```

Use:

```text
live recent data -> live QuestDB table/path
late data       -> controlled late lane
historical data -> batch/backfill lane
```

### 9.6 Prevention

```text
- event age histogram at ingestion gateway
- producer clock skew detection
- max allowed lateness policy
- separate backfill credentials/service
- replay runbook with throughput cap
- partition strategy chosen with late data profile
```

---

## 10. Incident 6: Query Storm / Slow Query / Dashboard Overload

### 10.1 Symptom

```text
- dashboard timeout
- API timeout
- CPU high
- memory pressure high
- query latency p95/p99 spikes
- ingestion may still be okay or may degrade indirectly
```

### 10.2 Common Causes

```text
- unbounded time range
- SELECT * over huge raw table
- too many concurrent dashboard panels
- high-cardinality GROUP BY
- ORDER BY over large range
- temporal join over broad range
- API exposes raw SQL too freely
- no materialized view for hot dashboard
```

### 10.3 Triage

Classify queries:

```text
latest-state query
small range raw query
rollup query
large ad-hoc analytical query
temporal join
export query
```

Find whether problem is:

```text
one pathological query
many normal queries
cache cold after restart
dashboards refreshed simultaneously
API user requesting too broad range
```

### 10.4 Immediate Mitigation

```text
1. Kill/stop offending client if identified.
2. Reduce dashboard refresh frequency.
3. Temporarily disable expensive panels.
4. Add API-side max range guardrail.
5. Route dashboard to materialized views/rollups.
6. Separate ad-hoc queries from production dashboard traffic if topology allows.
```

Java API guardrail:

```java
Duration range = Duration.between(from, to);
if (range.compareTo(maxAllowedRangeForEndpoint) > 0) {
    throw new BadRequestException("time range too large for this endpoint");
}
```

### 10.5 Prevention

```text
- query templates instead of arbitrary SQL
- endpoint-specific max time range
- required tenant/device filters
- materialized views for dashboards
- separate heavy export path
- rate limit per user/service
- dashboard staggered refresh
```

---

## 11. Incident 7: Materialized View Stale or Wrong

### 11.1 Symptom

```text
- raw table contains data
- dashboard aggregate does not reflect recent data
- rollup is stale
- late data missing from aggregate
- aggregate differs from raw query
```

### 11.2 First Question

```text
Is the MV stale, semantically wrong, or outside refresh-late-data policy?
```

These are different:

```text
stale
→ refresh not caught up

wrong
→ query definition/unit/filter bug

late-data excluded
→ expected according to refresh policy but perhaps unacceptable to user
```

### 11.3 Triage

```sql
SELECT max(timestamp) FROM raw_table;
SELECT max(bucket_ts) FROM mv_table;
```

Check:

```text
base table freshness
MV freshness
refresh strategy
late data policy
WAL/apply lag on base table
MV refresh errors/logs
```

### 11.4 Immediate Mitigation

```text
- route critical API temporarily to raw query if range is small
- manually refresh if configured/appropriate
- pause dashboard claim of real-time accuracy
- display freshness timestamp in UI
```

### 11.5 Prevention

```text
- always expose aggregate freshness
- define partial bucket semantics
- define late data correction policy
- test MV against raw query for sampled intervals
- avoid opaque dashboard-only truth
```

---

## 12. Incident 8: Schema Pollution / Bad Producer

### 12.1 Symptom

```text
- unexpected columns appear
- column count grows
- table becomes sparse/wide
- new symbols/cardinality explode
- ingestion errors due type mismatch
- query performance degrades
```

### 12.2 Causes

```text
- auto column creation enabled in unsafe environment
- producer sends dynamic field names
- metric name encoded as column name
- user/session/request ID encoded as symbol
- unit/type changed without versioning
- test producer writes to production table
```

### 12.3 Immediate Mitigation

```text
1. Identify offending producer.
2. Stop or quarantine it.
3. Disable auto schema evolution path where appropriate.
4. Route untrusted events to quarantine table/topic.
5. Decide whether table cleanup/migration is needed.
```

### 12.4 Diagnostic Questions

```text
Which columns were added?
When did they appear?
Which producer version started then?
Did cardinality spike?
Did storage growth change?
Did query latency change?
Can bad data be ignored, deleted by partition, or must table be rebuilt?
```

### 12.5 Prevention

```text
- ingestion gateway schema validation
- producer contract tests
- metric registry
- disallow dynamic column names
- symbol cardinality budget
- table ownership model
- staging table for untrusted producers
```

---

## 13. Incident 9: Duplicate Rows / Retry Amplification

### 13.1 Symptom

```text
- aggregates too high
- count unexpectedly doubles
- replay produces duplicate data
- Java retry after timeout writes same event twice
- Kafka consumer restart creates repeated rows
```

### 13.2 Root Cause Pattern

```text
unknown write outcome
+ non-idempotent ingestion
+ replay/retry
= duplicate rows
```

### 13.3 Immediate Mitigation

```text
1. Stop replay/retry source.
2. Identify affected interval.
3. Determine if table has dedup keys.
4. If not, decide whether to rebuild affected interval/table.
5. Fix producer idempotency before replaying again.
```

### 13.4 Prevention

```text
- define UPSERT/dedup keys before production
- include designated timestamp in dedup key where required
- use stable event identity
- make Kafka offset replay safe
- test duplicate replay in staging
```

Do not rely on “retry rarely happens”. In distributed systems, retry is normal.

---

## 14. Incident 10: Wrong Timestamp / Clock Skew

### 14.1 Symptom

```text
- data appears in wrong day/hour partition
- dashboards show gaps
- future timestamps appear
- TTL removes data earlier/later than expected
- latest queries return impossible records
- O3 storm due old timestamps
```

### 14.2 Causes

```text
- producer sends ingestion time instead of event time
- device clock wrong
- timezone conversion bug
- milliseconds treated as microseconds/nanoseconds
- local time used without timezone discipline
- timestamp field defaulted on retry
```

### 14.3 Immediate Mitigation

```text
1. Stop offending producer.
2. Determine timestamp error class: future, past, scale, timezone.
3. Identify affected partitions.
4. Decide correction strategy: ignore, rebuild, correction table, replay.
5. Add timestamp validation in ingestion gateway.
```

### 14.4 Java Guardrail

```java
Instant eventTime = event.timestamp();
Instant now = clock.instant();

if (eventTime.isAfter(now.plus(maxFutureSkew))) {
    reject("event timestamp too far in future");
}

if (eventTime.isBefore(now.minus(maxAllowedLateness))) {
    routeToLateLane(event);
}
```

### 14.5 Prevention

```text
- require UTC instant internally
- keep original source timestamp separately if needed
- expose event age histogram
- validate timestamp scale
- device clock drift monitoring
- late/future quarantine lane
```

---

## 15. Incident 11: Cardinality Explosion

### 15.1 Symptom

```text
- symbol cardinality grows rapidly
- memory/storage grows unexpectedly
- GROUP BY queries degrade
- index/storage overhead increases
- query results become too large
```

### 15.2 Common Bad Dimensions

```text
request_id
session_id
trace_id
user_id at huge scale
full URL with query string
error message text
UUID per event
IP address in some workloads
high-cardinality label combinations
```

### 15.3 Immediate Mitigation

```text
1. Identify exploding column/dimension.
2. Stop offending producer or field.
3. Route raw high-cardinality data elsewhere if needed.
4. Preserve low-cardinality dimensions for QuestDB query path.
5. Plan table rebuild if pollution is severe.
```

### 15.4 Prevention

```text
- symbol approval list
- cardinality budget per dimension
- ingestion gateway rejects dangerous dimensions
- high-cardinality fields stored as VARCHAR only if truly needed
- separate raw event store for high-cardinality forensic data
```

---

## 16. Incident 12: Retention / TTL Misconfiguration

### 16.1 Symptom

```text
- data disappeared earlier than expected
- disk keeps growing despite expected TTL
- old partitions remain
- compliance retention violated
- rollup retained but raw missing unexpectedly
```

### 16.2 Causes

```text
- TTL not configured
- TTL unit misunderstood
- partition granularity too coarse for desired retention
- table not partitioned as expected
- retention differs between raw and MV
- manual partition drop executed on wrong table
```

### 16.3 Immediate Mitigation

If data was deleted:

```text
1. Stop further lifecycle operations.
2. Identify affected table/partition/time range.
3. Check backups/snapshots/object storage copies.
4. Restore to separate environment first.
5. Validate before reattaching/reimporting.
```

If data is not being deleted:

```text
1. Check TTL config.
2. Check partition granularity.
3. Check whether old data is in raw, MV, or backup path.
4. Estimate disk time-to-full.
5. Drop safe old partitions only under retention policy.
```

### 16.4 Prevention

```text
- retention policy stored in architecture docs
- TTL tested in staging
- table name/time range confirmation before drop
- legal hold process
- backup restore drill
- disk forecast alert
```

---

## 17. Incident 13: Backup / Restore Failure

### 17.1 Symptom

```text
- backup job succeeded but restore fails
- restored table missing recent data
- inconsistent files
- wrong snapshot point
- object storage copy incomplete
```

### 17.2 Root Causes

```text
- backup not WAL-aware
- filesystem snapshot not atomic
- backup did not include required metadata
- restore never tested
- storage path mismatch
- permissions mismatch
- lifecycle deleted required partition
```

### 17.3 Runbook

```text
1. Treat backup as untrusted until restored and queried.
2. Restore into isolated environment.
3. Validate table list.
4. Validate row counts per key interval.
5. Validate max timestamp/freshness.
6. Validate sample query correctness.
7. Only then use for recovery/cutover.
```

### 17.4 Prevention

```text
- scheduled restore drill
- RPO/RTO documented
- checksum/manifest if possible
- clear backup boundary
- separate backup storage credentials
- restore automation tested on fresh machine
```

---

## 18. Decision Tree: Freshness Alert Fires

When dashboard/API says data is stale:

```text
START: freshness lag high

1. Are producers sending data?
   NO  -> upstream producer/broker issue
   YES -> continue

2. Is QuestDB accepting writes?
   NO  -> ingestion endpoint/network/schema/disk issue
   YES -> continue

3. Are WAL pending rows growing?
   YES -> WAL apply lag / suspension / O3 / disk / throughput issue
   NO  -> continue

4. Is raw table fresh but MV stale?
   YES -> MV refresh issue / late-data policy
   NO  -> continue

5. Is query filtered incorrectly?
   YES -> API/query/dashboard bug
   NO  -> continue

6. Are timestamps wrong/future/past?
   YES -> producer timestamp/clock issue
   NO  -> investigate table-specific logs/query plan
```

This tree prevents a common mistake:

```text
Dashboard stale
→ blame QuestDB
```

Instead:

```text
Dashboard stale
→ locate stale boundary
```

---

## 19. Decision Tree: WAL Lag Grows

```text
START: WAL lag grows continuously

1. Is table suspended?
   YES -> fix suspension cause, follow WAL resume runbook
   NO  -> continue

2. Is disk full/slow?
   YES -> free/expand disk, throttle ingestion
   NO  -> continue

3. Is data out-of-order/late?
   YES -> pause backfill, split late lane, sort replay
   NO  -> continue

4. Did ingestion rate increase?
   YES -> throttle producers / scale topology / capacity review
   NO  -> continue

5. Did schema widen/cardinality increase?
   YES -> stop bad producer, schema incident
   NO  -> continue

6. Are materialized views/refresh jobs competing?
   YES -> adjust refresh strategy/concurrency
   NO  -> deeper engine/OS/log investigation
```

---

## 20. Decision Tree: Disk Growth Alert Fires

```text
START: disk projected time-to-full too low

1. Did ingest rate increase?
   YES -> capacity/workload change
   NO  -> continue

2. Did schema widen or cardinality explode?
   YES -> schema/cardinality incident
   NO  -> continue

3. Did TTL stop working or retention not configured?
   YES -> lifecycle config issue
   NO  -> continue

4. Did backfill/replay start?
   YES -> backfill storage impact
   NO  -> continue

5. Did MV/rollup grow unexpectedly?
   YES -> derived table lifecycle issue
   NO  -> continue

6. Did WAL backlog accumulate?
   YES -> WAL apply issue consuming space
   NO  -> inspect partition/object storage/backup path
```

---

## 21. Runbook Template

Every serious production QuestDB deployment should have runbooks in this shape.

```markdown
# Runbook: <Incident Name>

## Trigger
- Alert name:
- Threshold:
- Duration:
- Severity:

## Customer Impact
- What users see:
- Data loss risk:
- Freshness risk:
- Query availability risk:

## First 5 Minutes
1.
2.
3.

## Diagnostic Queries
```sql
SELECT ...;
```

## OS/Kubernetes Checks
```bash
...
```

## Immediate Mitigation
- Safe actions:
- Unsafe actions:

## Recovery Procedure
1.
2.
3.

## Validation
- Query validation:
- App validation:
- Dashboard validation:

## Escalation
- Owner:
- When to page DBA/platform:
- When to notify product/customer:

## Prevention Follow-Up
- Config change:
- Alert change:
- Producer contract change:
- Capacity model update:
```

---

## 22. Java-Side Incident Controls

QuestDB incidents become worse if Java producers behave recklessly.

A production Java ingestion service should have:

```text
bounded queue
rate limiter
circuit breaker
retry budget
DLQ/quarantine path
timestamp validator
schema validator
cardinality guard
freshness-aware throttle
backfill pause switch
producer version tagging
```

### 22.1 Example Control Loop

```java
public final class QuestDbIngestionController {
    private final RateLimiter liveRateLimiter;
    private final RateLimiter backfillRateLimiter;
    private final QuestDbHealthClient healthClient;

    public void adjustRates() {
        QuestDbHealth health = healthClient.currentHealth();

        if (health.diskTimeToFull().compareTo(Duration.ofHours(12)) < 0) {
            backfillRateLimiter.setRate(0);
            liveRateLimiter.reduceBy(0.50);
            return;
        }

        if (health.walLagRows() > 10_000_000 || health.freshnessLag().compareTo(Duration.ofMinutes(5)) > 0) {
            backfillRateLimiter.setRate(0);
            liveRateLimiter.reduceBy(0.25);
            return;
        }

        if (health.isHealthy()) {
            liveRateLimiter.graduallyRecover();
            backfillRateLimiter.graduallyRecover();
        }
    }
}
```

This is not a replacement for human runbooks. It prevents a common incident amplifier:

```text
QuestDB slows down
→ Java producers retry harder
→ QuestDB gets worse
```

Correct behavior:

```text
QuestDB slows down
→ producers slow down
→ backlog stays bounded
→ recovery becomes possible
```

---

## 23. Severity Model

Example severity mapping:

| Severity | Condition | Example |
|---|---|---|
| SEV1 | data loss risk or write path unavailable for critical stream | disk full, table suspended for critical market feed |
| SEV2 | stale critical data but no confirmed loss | WAL lag growing, dashboard stale > SLA |
| SEV3 | degraded query/API performance | dashboard p99 timeout, heavy ad-hoc query |
| SEV4 | early warning | disk time-to-full under threshold, cardinality growth anomaly |

Severity should reflect business impact, not only technical metric.

```text
100M pending rows for a non-critical backfill may be SEV3.
1M pending rows for real-time risk monitoring may be SEV1.
```

---

## 24. Anti-Patterns

### 24.1 Restart-First Operations

```text
Symptom appears
→ restart database
→ evidence lost
→ root cause unknown
→ incident repeats
```

Restart can be valid, but not as reflex.

### 24.2 Infinite Producer Retry

```text
QuestDB rejects or slows
→ producer retries infinitely
→ duplicate/replay/backlog grows
→ system collapses harder
```

Use retry budget, idempotency, DLQ, and backpressure.

### 24.3 One Pipeline for Live + Backfill

```text
historical replay floods live ingestion
→ real-time freshness lost
```

Separate lanes.

### 24.4 Dashboard Without Time Bounds

```text
user opens dashboard
→ query scans months of raw data
→ shared system suffers
```

Enforce API bounds.

### 24.5 No Freshness Display

```text
dashboards show values
but not max event timestamp
→ stale data looks authoritative
```

Every operational dashboard should expose freshness.

### 24.6 Manual File Deletion

```text
rm -rf some QuestDB directory
→ corruption / irrecoverable inconsistency
```

Use documented SQL/lifecycle/backup mechanisms.

---

## 25. Production Checklist

Before operating QuestDB in production, confirm:

```text
[ ] critical tables have freshness SLO
[ ] tables() health is monitored
[ ] WAL lag alert exists
[ ] table suspension alert exists
[ ] disk time-to-full alert exists
[ ] inode/file descriptor monitoring exists
[ ] Java producers have bounded queues
[ ] Java producers have retry budgets
[ ] backfill can be paused independently
[ ] live ingestion can be throttled safely
[ ] event timestamp validation exists
[ ] schema/cardinality validation exists
[ ] dashboard/API queries have time bounds
[ ] materialized view freshness is visible
[ ] disk-full runbook exists
[ ] WAL suspended runbook exists
[ ] O3 storm runbook exists
[ ] duplicate/replay runbook exists
[ ] backup restore drill has been performed
[ ] partition drop procedure has approval guard
[ ] escalation owner is defined
```

---

## 26. Summary

The core lesson of this part:

```text
A QuestDB incident is usually a pipeline imbalance before it is a database mystery.
```

Good operators do not only ask:

```text
Is QuestDB up?
```

They ask:

```text
Are producers healthy?
Is ingestion accepted?
Is WAL applying?
Is table fresh?
Are materialized views fresh?
Are queries bounded?
Is disk safe?
Is lifecycle working?
Is data semantically correct?
```

The practical production model:

```text
observe
→ locate boundary
→ reduce pressure
→ preserve evidence
→ fix root cause
→ validate freshness/correctness
→ update runbook/capacity/contracts
```

QuestDB can handle high-throughput time-series workloads, but production reliability comes from the surrounding system:

```text
safe producers
bounded ingestion
clear schema contracts
retention discipline
freshness monitoring
failure-specific runbooks
```

---

## 27. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-024.md
Backup, Restore, Replication, and Disaster Recovery
```

We will move from incident response to resilience planning:

```text
How do we survive node loss, disk loss, bad deployment, accidental deletion, and regional failure?
How do we define RPO/RTO for time-series data?
How do WAL, backups, snapshots, replication, and restore drills fit together?
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-022.md">⬅️ Observability, Monitoring, and Alerting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-024.md">Part 024 — Backup, Restore, Replication, and Disaster Recovery ➡️</a>
</div>

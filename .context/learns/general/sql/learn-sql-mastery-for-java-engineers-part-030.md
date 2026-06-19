# learn-sql-mastery-for-java-engineers-part-030.md

# Part 30 — Observability, Operations, Backup, Restore, and Disaster Recovery

> Seri: SQL Mastery for Java Engineers  
> Bagian: 030 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-029.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-031.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas scaling patterns:

- partitioning
- sharding
- replication
- read replicas
- failover
- tenant scaling
- cache
- hot keys
- connection scaling

Sekarang kita membahas sisi yang sering membedakan engineer senior dari engineer yang hanya bisa menulis query: **database operations**.

Database production bukan hanya schema dan query. Ia adalah sistem hidup yang harus:

- diamati
- dimonitor
- dibackup
- direstore
- dipulihkan setelah incident
- dirawat
- dituning
- diuji
- diamankan
- direncanakan kapasitasnya
- dioperasikan saat traffic nyata

Kamu harus bisa menjawab:

```text
Query mana yang paling mahal?
Kenapa latency p99 naik?
Apakah DB CPU-bound atau IO-bound?
Apakah connection pool habis?
Apakah lock wait terjadi?
Apakah replica lag?
Apakah backup benar-benar bisa direstore?
Berapa RPO/RTO kita?
Apa langkah jika primary DB hilang?
Apakah migration menyebabkan bloat?
Apakah autovacuum/purge berjalan?
Apakah disk akan penuh dalam 7 hari?
Apakah restore sudah pernah dites?
```

Bagian ini membahas mental model dan checklist operasional database untuk Java backend engineer.

Kalimat inti:

> Database yang benar bukan hanya yang datanya konsisten saat query dijalankan, tetapi yang bisa diamati, dipulihkan, dirawat, dan dioperasikan dengan aman saat terjadi kegagalan nyata.

---

## 1. Database Operations Mindset

Operasional database bukan hanya tugas DBA/SRE.

Java backend engineer perlu memahami karena aplikasi memengaruhi database melalui:

- query shape
- transaction length
- connection pool size
- retry behavior
- batch jobs
- ORM behavior
- migrations
- logging
- timeouts
- lock patterns
- export/import jobs
- tenant workload
- read replica usage
- cache strategy

Jika aplikasi buruk, database operations ikut buruk.

Database operations adalah shared responsibility.

---

## 2. Observability: Three Signals

Observability minimum:

```text
metrics
logs
traces
```

Untuk database, tambahkan:

```text
query statistics
execution plans
lock graphs
replication status
backup status
storage growth
maintenance activity
```

Kamu perlu melihat dari dua sisi:

### 2.1 Application Side

- endpoint latency
- DB call duration
- connection acquisition time
- transaction duration
- query count per request
- rows returned
- retry count
- exceptions
- pool metrics

### 2.2 Database Side

- CPU
- memory/cache
- disk IO
- locks
- waits
- slow queries
- top queries by total time
- active sessions
- replication lag
- vacuum/analyze/purge
- deadlocks
- temp files/sort spills
- table/index bloat
- storage

Kedua sisi harus dikorelasikan.

---

## 3. Golden Signals for Database

Monitor:

```text
latency
traffic
errors
saturation
```

### 3.1 Latency

- query duration
- transaction duration
- connection acquisition latency
- lock wait time
- commit latency
- replication apply delay
- backup duration
- restore duration

### 3.2 Traffic

- queries/sec
- transactions/sec
- rows read/written
- bytes read/written
- connections
- batch job throughput
- replication WAL/redo volume

### 3.3 Errors

- deadlocks
- serialization failures
- lock timeouts
- statement timeouts
- connection failures
- constraint violations
- disk full
- backup failures
- replication failures

### 3.4 Saturation

- CPU
- memory
- buffer/cache hit ratio
- disk IOPS
- disk throughput
- connection slots
- worker threads
- temp space
- lock queues
- replication lag
- storage capacity

---

## 4. Application DB Metrics

Every Java service should expose DB-related metrics.

Recommended:

```text
db.query.duration
db.query.count
db.query.rows
db.query.errors
db.transaction.duration
db.connection.acquire.duration
db.connection.pool.active
db.connection.pool.idle
db.connection.pool.pending
db.connection.pool.timeout.count
db.retry.count
db.deadlock.count
db.serialization_failure.count
```

Tag carefully:

```text
query_name
repository
operation
database
shard
tenant_tier
result
```

Do not tag with high-cardinality raw SQL or tenant_id unless metrics system supports it.

Use stable query names.

---

## 5. Query Naming

Use named query comments or instrumentation.

Example:

```sql
/* app=case-service query=CaseRepository.findOpenQueue */
SELECT ...
```

Benefits:

- slow query logs map to code owner
- DB stats easier to interpret
- APM traces clearer
- incident triage faster

Rules:

- stable names
- no user input in comments
- no PII
- keep names short
- include service/module/query identifier

---

## 6. Slow Query Logs

Slow query logs capture queries exceeding threshold.

Threshold example:

```text
log queries > 500ms
```

But threshold depends workload.

For OLTP endpoint, 100ms may be slow.

For report job, 30s may be expected.

Slow query log should capture:

- SQL text/fingerprint
- duration
- rows examined/returned if available
- lock wait if available
- temp files/spills
- user/database
- timestamp
- application name/comment

Use slow query logs to find:

- missing index
- bad plan
- N+1 pattern
- unexpected sequential scans
- sorting spills
- lock waits disguised as slow query
- huge result sets

---

## 7. Top Query Statistics

PostgreSQL has `pg_stat_statements`; other DBs have equivalents.

Look at:

```text
total time
mean time
p95/p99 if available
calls
rows
shared blocks read/hit
temp blocks
plans
```

A query with average 5ms but 10 million calls may cost more than one 10s report.

Prioritize by:

```text
total impact = frequency × cost
```

Categories:

- high total time
- high mean latency
- high variance
- high IO
- high temp usage
- high rows returned
- high calls

---

## 8. Execution Plans in Operations

During incident, do not only ask:

```text
Is there an index?
```

Ask:

```text
What plan is actually used?
```

Need:

- actual plan with runtime
- estimated vs actual rows
- buffers/IO
- loops
- sort/hash memory
- temp spill
- join order
- predicate vs filter
- parameter values or representative values

Plan regression happens due to:

- changed statistics
- data distribution shift
- parameter sniffing/generic plans
- new index
- removed index
- changed query
- table growth
- stale stats
- version upgrade

Execution plans are operational evidence.

---

## 9. Lock Observability

Monitor:

- lock waits
- blocked sessions
- blocker sessions
- deadlocks
- transaction age
- idle in transaction
- rows locked by long updates
- DDL waiting for locks

Questions:

```text
Who is blocked?
Who is blocking?
How long?
What query holds lock?
What transaction age?
Is blocker idle?
Is it app or migration?
Can it be safely cancelled?
```

Lock wait incident often looks like “database slow” even if CPU low.

---

## 10. Deadlock Monitoring

Deadlocks should be logged with graph/details.

Track:

```text
deadlock count by query/service
deadlock victim
objects involved
time
transaction statements
```

Occasional deadlocks can happen in high concurrency systems.

Frequent deadlocks indicate:

- inconsistent lock order
- missing indexes
- large transactions
- broad updates
- FK locking issues
- batch job conflict
- poor retry design

Application should retry deadlock victims if operation is safe/idempotent.

---

## 11. Connection Pool Observability

Connection pool exhaustion is common.

Hikari metrics:

```text
active
idle
pending
max
min
acquire time
timeout count
```

Symptoms:

- app threads waiting for DB connection
- DB not necessarily saturated
- slow endpoint latency but query time low
- long transactions holding connections
- connection leak
- too much concurrency
- pool too small or DB too slow

Do not blindly increase pool size.

If DB already saturated, larger pool worsens.

---

## 12. Transaction Duration Monitoring

Long transactions cause:

- locks held
- MVCC cleanup blocked
- bloat
- connection held
- replica conflicts
- vacuum/purge delay
- more deadlock risk

Track:

```text
transaction duration by endpoint/job
active transaction age in DB
idle in transaction
```

Alert on:

```text
idle in transaction > 60s
transaction > expected threshold
```

Business endpoints should usually have short transactions.

---

## 13. Database Wait Events

Many databases expose wait categories.

Examples:

- CPU running
- IO wait
- lock wait
- latch/buffer wait
- network wait
- replication wait
- commit/fsync wait
- temp file IO
- client read/write wait

Wait events tell what database is waiting for.

If DB is lock waiting, adding CPU does not help.

If DB is IO-bound, query/index/cache/storage matter.

If DB waits on client, app may be slow consuming result set.

---

## 14. CPU-Bound vs IO-Bound

CPU-bound signs:

- high CPU
- many active queries
- complex joins/sorts/aggregates
- expression-heavy queries
- JSON processing
- decompression/compression
- high parsing/planning overhead

IO-bound signs:

- high disk read latency
- low cache hit
- many physical reads
- large scans
- insufficient memory/cache
- random IO
- temp spills
- checkpoint pressure

Different fixes:

```text
CPU: query rewrite, reduce work, indexes, cache, scale CPU
IO: indexes, memory, storage, partitioning, avoid scans, reduce temp spills
```

---

## 15. Cache/Buffer Metrics

Database buffer cache hit ratio can indicate whether working set fits memory.

But do not worship one metric blindly.

A high cache hit ratio can still have slow queries due to CPU/locks.

A lower hit ratio may be okay for analytical scans.

Use cache metrics with query evidence.

Important:

- hot tables/indexes
- physical reads
- cache evictions
- working set growth
- index-only scan effectiveness

---

## 16. Temp Files and Sort Spills

Queries may spill to disk for:

- sort
- hash join
- hash aggregate
- window functions
- large DISTINCT
- large GROUP BY

Symptoms:

- temp file logs
- high temp IO
- slow reports
- memory settings insufficient
- bad query shape

Fix options:

- better index to avoid sort
- reduce rows earlier
- pre-aggregate
- increase work memory carefully
- materialized view/read model
- partition workload
- move to warehouse

---

## 17. Statistics Maintenance

Optimizer needs statistics.

Stats can become stale after:

- large import
- bulk update
- data skew changes
- partition creation
- table growth
- delete/archive
- migration

Operations:

```sql
ANALYZE table_name;
```

or automatic analyze.

If estimates are wrong, plans go bad.

Monitor:

- estimated vs actual rows in plans
- stale stats
- auto-analyze frequency
- partition stats
- extended stats for correlated columns if supported

---

## 18. Vacuum / Purge / Cleanup

MVCC databases need cleanup of old row versions.

PostgreSQL: VACUUM/autovacuum.

InnoDB: purge/undo cleanup.

If cleanup lags:

- table bloat
- index bloat
- storage growth
- slower scans
- transaction ID issues in PostgreSQL
- worse cache efficiency

Causes:

- long transactions
- heavy update/delete
- autovacuum under-tuned
- huge batch jobs
- too many indexes
- insufficient IO
- disabled maintenance

Java app contributes through transaction length and write patterns.

---

## 19. Bloat

Bloat = unused/dead space inside table/index.

Causes:

- updates create new versions
- deletes leave dead space until cleanup
- frequent updates to indexed columns
- long transactions blocking cleanup
- bulk operations
- low fillfactor choices
- inadequate vacuum

Effects:

- larger storage
- slower scans
- larger indexes
- worse cache efficiency
- longer backup/restore

Monitor table/index size over time.

Bloat fixes may require vacuum, reindex, table rewrite, or partition strategy.

---

## 20. Maintenance Windows

Some operations are expensive:

- rebuild index
- vacuum full/table rewrite
- large migration
- partition maintenance
- stats refresh
- backup verification
- data archive
- re-clustering
- materialized view refresh

Plan:

- low traffic window
- expected duration
- lock behavior
- rollback/fix-forward
- monitoring
- communication
- runbook

Modern systems aim for online maintenance, but not all operations are online.

---

## 21. Capacity Planning

Track growth:

```text
data size
index size
WAL/redo volume
backup size
connection count
query rate
write rate
storage IOPS
CPU
memory
replica lag
tenant distribution
audit/event growth
```

Forecast:

```text
when disk reaches 70%, 80%, 90%
when backups exceed window
when restore time exceeds RTO
when partitions become too large
when index build duration exceeds window
```

Capacity planning prevents emergency scaling.

---

## 22. Disk Full Is a Critical Incident

If database disk fills:

- writes fail
- replication may stop
- database may crash or become read-only
- recovery may be painful
- backups may fail
- WAL/redo cannot be written

Prevent with:

- alerts at thresholds
- growth forecasting
- retention policies
- partition drop/archive
- backup/WAL cleanup
- temp file monitoring
- emergency runbook

Never ignore disk growth.

---

## 23. Backup Concepts

Backup types:

### 23.1 Physical Backup

Copy database files/storage.

Pros:

- complete
- good for full restore
- often faster

Cons:

- database/version-specific
- large
- not fine-grained
- requires consistency mechanism

### 23.2 Logical Backup

SQL dump/export.

Pros:

- portable-ish
- selective
- inspectable
- useful for small DB/object

Cons:

- slower for large DB
- restore slower
- may miss roles/grants/config if not careful
- not ideal for huge production recovery

### 23.3 Snapshot

Storage/cloud snapshot.

Pros:

- fast
- operationally convenient

Cons:

- consistency requirements
- cloud-specific
- restore testing required
- not enough without WAL/PITR for point-in-time

---

## 24. Point-In-Time Recovery (PITR)

PITR restores database to specific time.

Needs:

- base backup
- continuous WAL/redo/archive logs
- restore process
- target timestamp/LSN
- tested procedure

Use cases:

- accidental delete
- bad migration
- ransomware
- application bug corrupted data
- need restore before incident

Questions:

```text
How far back can we recover?
How much data can we lose?
How long does restore take?
Who can initiate?
Was it tested?
```

PITR is essential for serious systems.

---

## 25. RPO and RTO

### 25.1 RPO — Recovery Point Objective

Maximum acceptable data loss.

```text
RPO = 5 minutes
```

Means you can lose at most 5 minutes of committed data.

### 25.2 RTO — Recovery Time Objective

Maximum acceptable downtime to restore service.

```text
RTO = 1 hour
```

Backup/replication strategy must meet RPO/RTO.

If restore takes 8 hours, your RTO is not 1 hour no matter what document says.

---

## 26. Backup Is Useless Until Restore Is Tested

A backup that cannot be restored is not a backup.

Test restore regularly:

- restore to isolated environment
- verify schema
- verify row counts
- verify app can start
- run smoke tests
- verify grants/RLS
- verify recent data
- measure restore duration
- document steps

Common failure:

```text
Backups ran successfully for months, but restore credentials/keys were missing.
```

Restore test catches this.

---

## 27. Backup Security

Backups contain sensitive data.

Protect:

- encryption
- key management
- access control
- audit access
- retention
- deletion
- legal hold
- secure transfer
- environment isolation
- restore approval

Production backup copied to dev without masking is a security breach risk.

Backups must follow data classification.

---

## 28. Disaster Recovery

Disaster recovery handles major failure:

- region down
- primary database lost
- corrupted data
- ransomware
- storage failure
- cloud account issue
- accidental destructive migration
- operator error

DR plan includes:

```text
RPO/RTO
backup/PITR
replicas
failover
restore environment
DNS/routing
secrets
application config
data validation
communication
runbook
ownership
testing schedule
```

A DR plan not rehearsed is mostly fiction.

---

## 29. High Availability vs Disaster Recovery

High availability:

```text
continue service through common failures
```

Examples:

- primary failover
- replica promotion
- multi-AZ cluster
- connection retry

Disaster recovery:

```text
recover from catastrophic failure/corruption
```

Examples:

- restore from backup
- rebuild region
- PITR before bad migration

Replication helps HA, but if corruption replicates, DR needs backups/PITR.

---

## 30. Incident Response: Database Slow

Runbook:

1. Is app waiting for DB connections?
2. Is DB CPU high?
3. Is IO high?
4. Are there lock waits?
5. Any long transactions?
6. Any recent deploy/migration/batch job?
7. Top queries by total time now?
8. Slow query logs?
9. Replica lag?
10. Disk/temp space?
11. Error/deadlock/timeout spike?
12. Which endpoints affected?

Immediate mitigations:

- stop/pause batch job
- cancel runaway query
- terminate idle blocking transaction carefully
- route reports away
- increase timeout only if appropriate
- add emergency index only after plan review
- shed low-priority traffic
- scale vertically if resource-bound
- rollback app if query regression

Do not guess. Observe.

---

## 31. Incident Response: Lock Storm

Symptoms:

- many sessions waiting
- CPU low
- latency high
- transactions stuck
- lock timeout errors

Steps:

1. identify blockers
2. inspect blocker transaction age/query
3. decide if safe to cancel blocker
4. pause conflicting jobs
5. check recent migration/batch
6. check missing index causing broad update
7. enable/adjust lock timeout for affected workflow
8. collect evidence for root cause

After incident:

- fix lock order
- reduce transaction duration
- add indexes
- batch writes
- change isolation/locking strategy
- add monitoring

---

## 32. Incident Response: Bad Migration

Symptoms:

- deploy stuck
- migration waiting on lock
- migration failed
- app errors after schema change
- table locked
- replication lag spikes
- disk grows

Steps:

1. stop further deploys
2. identify migration state
3. check migration history table
4. check locks/blockers
5. decide cancel/continue
6. if partial, inspect actual schema
7. apply fix-forward migration if needed
8. rollback app only if DB compatible
9. communicate status
10. document postmortem

Never rerun failed migration blindly.

---

## 33. Incident Response: Accidental Delete

If data deleted:

1. stop destructive process
2. identify scope/time
3. preserve logs/audit
4. decide restore strategy:
   - restore backup to separate environment
   - PITR clone
   - logical copy missing rows
   - full restore if catastrophic
5. prevent app writes if needed
6. validate restored data
7. reinsert/repair
8. audit and notify as required

Replication does not help if delete replicated.

PITR clone often allows surgical recovery.

---

## 34. Disaster Drill

Practice:

```text
Restore latest backup to staging.
Restore to point in time before known marker.
Promote replica in test.
Run app smoke tests.
Verify RLS/grants.
Measure duration.
Verify runbook accuracy.
```

Record:

- actual RTO
- actual RPO
- missing permissions
- missing secrets
- slow steps
- manual ambiguity
- data validation issues

Improve runbook.

---

## 35. Database Upgrade Operations

Upgrades can change:

- optimizer behavior
- SQL syntax
- reserved words
- statistics
- index behavior
- driver compatibility
- extension compatibility
- replication
- backup format
- authentication
- default settings

Plan:

- read release notes
- test app integration
- run query regression tests
- compare execution plans
- test migrations
- test rollback/failover
- upgrade replicas first if supported
- monitor after cutover

DB upgrades are high-risk operations.

---

## 36. Driver and Pool Upgrades

JDBC driver upgrades can change:

- type mapping
- timestamp behavior
- prepared statement behavior
- fetch size behavior
- SSL defaults
- authentication support
- error codes
- performance

Connection pool upgrades can change:

- defaults
- timeout behavior
- validation behavior
- metrics

Test critical queries and transaction behavior after upgrade.

---

## 37. Configuration as Code

Database-related config should be versioned:

- parameter groups
- connection limits
- timeouts
- autovacuum settings
- replication settings
- backup retention
- maintenance windows
- RLS/grants migration
- monitoring alerts
- pool settings
- read routing rules

Manual config drift causes incidents.

Use infrastructure-as-code where possible.

---

## 38. Alerting

Good alerts are actionable.

Examples:

```text
DB disk > 80% and growth predicts full < 7 days
replica lag > 60s for 5 minutes
backup failed
no successful backup in 24h
deadlocks spike above baseline
connection pool pending > threshold
p95 DB query latency high
idle in transaction > 5 minutes
migration running > expected
WAL archive failing
```

Avoid alert noise.

Alert should include dashboard/runbook link.

---

## 39. SLOs for Database-Backed Services

Service SLOs often depend on DB.

Examples:

```text
99.9% of case lookup requests < 300ms
99% of close-case commands complete < 1s
replica lag < 10s for dashboard
backup restore tested monthly
PITR available for last 7 days
```

Define SLOs by user/business need.

Database internal metrics support these SLOs.

---

## 40. Data Corruption and Consistency Checks

Not all corruption is storage-level. App bugs can corrupt semantics.

Examples:

- case status CLOSED but no closed_at
- assignment has two active primary officers
- read model count drift
- orphan rows
- audit missing for decision
- outbox event missing
- external refs duplicated

Run periodic consistency checks:

```sql
SELECT case_id
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL
GROUP BY case_id
HAVING COUNT(*) > 1;
```

Turn critical invariants into constraints where possible.

For non-constraint checks, monitor.

---

## 41. Reconciliation Jobs

From part 028:

- source-target reconciliation
- read model drift
- external system sync
- reporting totals
- audit coverage

Operationalize reconciliation:

- schedule
- store results
- alert on failures
- provide repair workflow
- make checks tenant/partition aware

Reconciliation is production correctness monitoring.

---

## 42. Runbooks

Runbook should include:

```text
symptom
impact
dashboard links
queries to inspect
safe commands
unsafe commands
decision criteria
rollback/fix-forward
owners
communication
post-incident tasks
```

Examples:

- lock storm
- replica lag
- disk full
- failed migration
- backup restore
- accidental delete
- slow query regression
- connection pool exhaustion
- stuck outbox publisher

Runbooks reduce panic.

---

## 43. Postmortems

After incident, write:

- timeline
- impact
- detection
- root cause
- contributing factors
- what worked
- what failed
- action items
- owners/dates

Avoid blame.

Database incidents often reveal system design weaknesses:

- missing timeout
- no slow query alert
- no tested restore
- migration process weak
- app query unbounded
- unclear ownership

Postmortems improve engineering system.

---

## 44. Operational Ownership

For every database object/process, know owner:

```text
critical tables
read models
materialized views
ETL jobs
backfills
migrations
RLS policies
backup config
alerts
dashboards
outbox publisher
partition maintenance
```

Unowned database assets rot.

Ownership means:

- know semantics
- monitor
- respond to incidents
- evolve safely
- document

---

## 45. Documentation

Document:

- schema purpose
- table grain
- key constraints
- retention
- PII classification
- migration procedure
- backup/restore
- partition strategy
- read replica consistency
- runbooks
- known expensive queries
- operational dashboards

Documentation must be close to code/migrations where possible.

---

## 46. Java Engineer Operational Checklist

When adding a new DB-heavy feature:

```text
[ ] Query names/instrumentation added?
[ ] Metrics capture latency/errors/rows?
[ ] Transaction duration bounded?
[ ] Connection pool impact estimated?
[ ] Query timeout set?
[ ] Lock timeout needed?
[ ] Slow query plan reviewed?
[ ] Indexes added safely?
[ ] Migration lock behavior known?
[ ] Backup/restore impacted?
[ ] Data retention considered?
[ ] Read model/reconciliation needed?
[ ] Alerts/runbook updated?
```

---

## 47. Common Operational Anti-Patterns

```text
[ ] no tested restore
[ ] replica treated as backup
[ ] no slow query visibility
[ ] no query names
[ ] app logs PII bind values
[ ] no connection pool metrics
[ ] pool size increased blindly
[ ] no transaction timeout
[ ] long idle transactions ignored
[ ] migrations run without lock awareness
[ ] huge backfill during peak traffic
[ ] backup success assumed without restore
[ ] disk alerts too late
[ ] read replicas used without lag awareness
[ ] no owner for materialized view refresh
[ ] no reconciliation for derived data
```

---

## 48. Practical Exercises

### Exercise 1 — Slow Endpoint

Endpoint p95 increased from 100ms to 3s. Describe investigation order across app metrics, pool metrics, DB top queries, locks, and recent deploys.

### Exercise 2 — Restore Drill

Design a monthly restore test for production backup.

### Exercise 3 — Lock Storm

Many sessions blocked by one idle transaction. Write incident response steps.

### Exercise 4 — Replica Lag

Dashboard reads from replica and shows stale data after write. Propose fixes.

### Exercise 5 — Disk Growth

Audit table grows 500GB/month. Design partition/retention/archive monitoring plan.

---

## 49. Koneksi ke Part Berikutnya

Part ini membahas observability, operations, backup, restore, and disaster recovery.

Part berikutnya, `part-031`, akan membahas analytical SQL, OLAP, warehousing, and reporting systems:

- OLTP vs OLAP
- star schema
- facts and dimensions
- analytical queries
- data warehouse
- reporting marts
- window analytics
- snapshots
- metrics correctness
- moving heavy analytics away from OLTP

Operations memastikan database tetap sehat. Analytics memastikan data bisa dipakai untuk insight tanpa merusak workload transaksi.

---

## 50. Ringkasan Bagian Ini

Hal penting dari part 030:

1. Database operations adalah shared responsibility antara backend, DBA, SRE, and data teams.
2. Observability harus mencakup app side dan database side.
3. Monitor latency, traffic, errors, and saturation.
4. Connection pool metrics penting untuk membedakan DB slow vs pool exhaustion.
5. Query naming membantu production debugging.
6. Slow query logs and top query stats reveal total impact.
7. Execution plans must be inspected for real production queries.
8. Lock waits and deadlocks need dedicated monitoring.
9. Long transactions harm locks, connections, and MVCC cleanup.
10. Wait events help identify CPU, IO, lock, client, or replication bottleneck.
11. Stats maintenance affects optimizer quality.
12. Vacuum/purge cleanup is essential in MVCC systems.
13. Bloat affects storage, cache, and performance.
14. Capacity planning prevents disk-full and restore-window surprises.
15. Backup is only real if restore is tested.
16. PITR is essential for accidental delete/bad migration recovery.
17. RPO/RTO must be measured, not just declared.
18. Replica is not backup.
19. Incidents need runbooks and postmortems.
20. Reconciliation and consistency checks are part of production correctness.

Kalimat inti:

> Engineer yang matang tidak hanya membuat database menjawab query hari ini, tetapi memastikan database bisa diamati, dipulihkan, dan tetap benar saat beban, kegagalan, dan perubahan production terjadi.

---

## 51. Referensi

1. PostgreSQL Documentation — Monitoring Database Activity.  
   https://www.postgresql.org/docs/current/monitoring.html

2. PostgreSQL Documentation — `pg_stat_statements`.  
   https://www.postgresql.org/docs/current/pgstatstatements.html

3. PostgreSQL Documentation — Routine Vacuuming.  
   https://www.postgresql.org/docs/current/routine-vacuuming.html

4. PostgreSQL Documentation — Backup and Restore.  
   https://www.postgresql.org/docs/current/backup.html

5. PostgreSQL Documentation — Continuous Archiving and PITR.  
   https://www.postgresql.org/docs/current/continuous-archiving.html

6. MySQL Documentation — Backup and Recovery.  
   https://dev.mysql.com/doc/refman/8.4/en/backup-and-recovery.html

7. MySQL Documentation — Performance Schema.  
   https://dev.mysql.com/doc/refman/8.4/en/performance-schema.html

8. SQL Server Documentation — Monitoring and Tuning.  
   https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitor-and-tune-for-performance

9. SQL Server Documentation — Backup and Restore.  
   https://learn.microsoft.com/en-us/sql/relational-databases/backup-restore/back-up-and-restore-of-sql-server-databases

10. Oracle Documentation — Backup and Recovery User's Guide.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/bradv/

11. Google SRE Book — Monitoring Distributed Systems.  
    https://sre.google/sre-book/monitoring-distributed-systems/

12. Google SRE Book — Disaster Recovery Testing.  
    https://sre.google/sre-book/data-integrity/

---

## 52. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`
- `learn-sql-mastery-for-java-engineers-part-025.md`
- `learn-sql-mastery-for-java-engineers-part-026.md`
- `learn-sql-mastery-for-java-engineers-part-027.md`
- `learn-sql-mastery-for-java-engineers-part-028.md`
- `learn-sql-mastery-for-java-engineers-part-029.md`
- `learn-sql-mastery-for-java-engineers-part-030.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-031.md` — Analytical SQL, OLAP, Warehousing, and Reporting Systems

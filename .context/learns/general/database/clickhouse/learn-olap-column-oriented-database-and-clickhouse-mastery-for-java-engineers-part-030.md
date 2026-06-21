# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-030.md

# Part 030 — Operations I: Deployment, Configuration, Monitoring, Alerting, and Day-2 Runbooks

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **030 / 034**  
> Fokus: menjalankan ClickHouse di produksi: deployment model, configuration management, cluster topology, monitoring, alerting, capacity, incidents, maintenance, upgrade, dan runbook day-2 operations.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

- OLAP mental model;
- storage dan MergeTree internals;
- schema, partitioning, sorting key;
- ingestion;
- query execution;
- materialized views;
- projections;
- joins;
- table engines;
- mutability;
- distributed and cloud-native ClickHouse;
- performance engineering;
- data modeling;
- Java integration;
- production ingestion pipelines.

Sekarang kita masuk ke **operations**.

Di produksi, ClickHouse bukan hanya SQL engine. Ia adalah sistem stateful yang memiliki:

- disk;
- memory;
- CPU;
- network;
- background merges;
- mutations;
- replication;
- Keeper/ZooKeeper;
- distributed queues;
- object storage/cache if cloud-native;
- users/profiles/quotas;
- schema migrations;
- backups;
- upgrades;
- incident response.

Banyak kegagalan ClickHouse terjadi bukan karena query SQL salah, tetapi karena:

- disk penuh;
- terlalu banyak parts;
- mutation stuck;
- replication queue menumpuk;
- Keeper session expired;
- distributed insert queue stuck;
- schema drift;
- slow query storm;
- BI user tanpa limit;
- backfill berjalan saat jam sibuk;
- no alert until dashboard users complain;
- no runbook during incident.

Part ini adalah fondasi operasi.

Part 031 akan fokus ke security, governance, privacy, access control, and compliance.  
Part 032 akan fokus ke backup, restore, disaster recovery, and migration.  
Part 033 akan fokus ke advanced production architecture/case studies.  
Part 034 akan menjadi capstone.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memahami deployment model ClickHouse: single node, replicated cluster, distributed cluster, cloud-managed, Kubernetes/operator;
2. membuat checklist production readiness;
3. memahami configuration management untuk server, users, profiles, quotas, macros, remote servers, Keeper;
4. memonitor health ClickHouse dari system tables dan metrics;
5. mendesain alerting yang actionable;
6. memahami day-2 runbooks untuk disk full, too many parts, slow queries, stuck mutations, replica lag, ingestion lag, Keeper issues, and schema drift;
7. membuat upgrade/maintenance strategy;
8. menerapkan capacity planning dan growth review;
9. mengelola workload isolation;
10. memahami operational responsibilities antara Java team, data platform team, SRE, and security;
11. membangun operational maturity roadmap dari dev/staging ke production.

---

## 2. Mental Model Utama: ClickHouse Operations = State + Background Work + Query Work

ClickHouse production health bukan hanya:

```text
server up
```

Tetapi:

```text
server up
+ disk headroom safe
+ parts healthy
+ merges progressing
+ mutations not stuck
+ replicas caught up
+ Keeper healthy
+ queries within SLA
+ ingestion not lagging
+ backups valid
+ schema consistent
+ limits protect cluster
```

ClickHouse melakukan banyak pekerjaan background:

- merging parts;
- applying TTL;
- applying mutations;
- replicating/fetching parts;
- materialized view insert processing;
- distributed insert forwarding;
- cache management;
- background cleanup.

Jika background work tidak sehat, query yang benar pun bisa lambat.

Operational mindset:

```text
ClickHouse is not just serving queries.
It is continuously reshaping data parts in the background.
```

---

## 3. Deployment Models

### 3.1 Single Node

```text
one ClickHouse server
local disk
no replicas
```

Good for:

- development;
- small workloads;
- proof of concept;
- low criticality internal analytics;
- isolated reporting.

Risks:

- no high availability;
- disk/node failure impact;
- limited scale;
- maintenance downtime.

### 3.2 Single Node with Backup

Better than nothing.

Still no HA, but recoverable if backups valid.

### 3.3 Replicated Pair

```text
one shard
two replicas
Keeper/ZooKeeper
ReplicatedMergeTree
```

Good for:

- HA;
- read availability;
- rolling maintenance;
- moderate dataset.

Risks:

- storage duplicated;
- Keeper required;
- replication lag;
- write semantics need understanding.

### 3.4 Distributed Cluster

```text
N shards × R replicas
Distributed tables
ReplicatedMergeTree local tables
Keeper/ZooKeeper
```

Good for:

- larger data;
- parallel scans;
- high ingestion;
- HA;
- multi-tenant analytics.

Risks:

- sharding complexity;
- coordinator bottleneck;
- distributed joins;
- data skew;
- schema drift;
- higher ops cost.

### 3.5 Cloud Managed / ClickHouse Cloud

Good for:

- managed operations;
- faster setup;
- cloud-native storage;
- managed scaling features;
- less Keeper/replica burden.

Risks:

- cost management;
- less low-level control;
- provider-specific behavior;
- governance/compliance review.

### 3.6 Kubernetes / Operator

Good for:

- platform standardization;
- declarative deployment;
- automation;
- cloud-native operations.

Risks:

- stateful workload complexity;
- storage performance;
- network/Keeper config;
- upgrades and pod disruption;
- operator-specific behavior.

### 3.7 Decision Rule

Start as simple as requirements allow, but do not ignore:

- availability;
- data loss tolerance;
- restore time;
- retention;
- workload growth;
- operational expertise.

---

## 4. Production Readiness Checklist

Before production:

### 4.1 Infrastructure

- [ ] Disk sized with headroom.
- [ ] Disk performance benchmarked.
- [ ] Network bandwidth sufficient.
- [ ] CPU/RAM sized.
- [ ] Time synchronization configured.
- [ ] Host limits configured.
- [ ] Monitoring agent installed.
- [ ] Log collection configured.

### 4.2 ClickHouse

- [ ] Version pinned.
- [ ] Config managed by code.
- [ ] Users/profiles/quotas defined.
- [ ] `remote_servers` configured if cluster.
- [ ] macros configured if replicated.
- [ ] Keeper/ZooKeeper HA if replicated.
- [ ] Backups configured.
- [ ] System tables monitored.
- [ ] Query log enabled/retained.
- [ ] Error log monitored.

### 4.3 Data Model

- [ ] Tables have proper engine.
- [ ] Partition key sane.
- [ ] Sorting key aligned.
- [ ] TTL defined where needed.
- [ ] Materialized views documented.
- [ ] Backfill strategy defined.
- [ ] Dedup strategy defined.
- [ ] Schema migration process defined.

### 4.4 Workload

- [ ] Query families known.
- [ ] Dashboard uses rollups/serving tables.
- [ ] Export async.
- [ ] BI users limited.
- [ ] Ingestion batch size tested.
- [ ] Backfill schedule controlled.
- [ ] Workload isolation defined.

### 4.5 Operations

- [ ] Alerts configured.
- [ ] Runbooks documented.
- [ ] On-call knows system tables.
- [ ] Backup restore tested.
- [ ] Upgrade procedure tested.
- [ ] Incident severity defined.
- [ ] Ownership clear.

---

## 5. Configuration Management

### 5.1 Treat Config as Code

ClickHouse config should be versioned:

```text
config.xml
users.xml
keeper config
remote_servers
macros
storage policies
profiles
quotas
dictionaries
```

Avoid manual edits on one node.

### 5.2 Config Categories

| Category | Examples |
|---|---|
| Server | listen_host, ports, logging |
| Storage | disks, policies, paths |
| Cluster | remote_servers, macros |
| Replication | Keeper/ZooKeeper paths |
| Users | users, passwords, auth |
| Profiles | query settings |
| Quotas | usage limits |
| Logs | query_log, trace_log |
| Security | TLS, access control |
| Integrations | dictionaries, object storage |

### 5.3 Environment Separation

Use separate configs for:

- dev;
- staging;
- production;
- DR.

Do not let staging write to production object storage or Keeper paths.

### 5.4 Avoid Config Drift

In cluster, config drift causes weird failures:

- node A sees cluster differently;
- remote_servers mismatch;
- macros wrong;
- users differ;
- profiles differ;
- table paths conflict.

Automate config distribution.

---

## 6. Cluster Configuration Essentials

### 6.1 remote_servers

Defines cluster topology.

Conceptual:

```xml
<remote_servers>
  <analytics_cluster>
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
  </analytics_cluster>
</remote_servers>
```

### 6.2 macros

Replicated tables often use macros:

```xml
<macros>
  <shard>01</shard>
  <replica>ch-01</replica>
</macros>
```

Used in:

```sql
ReplicatedMergeTree('/clickhouse/tables/{shard}/events_local', '{replica}')
```

### 6.3 Common Mistakes

- two replicas have same `{replica}`;
- wrong `{shard}`;
- inconsistent cluster name;
- table path not unique;
- local/distributed table mismatch;
- config changed on one node only.

### 6.4 Verify Cluster

```sql
SELECT *
FROM system.clusters
WHERE cluster = 'analytics_cluster';
```

Check from every node.

---

## 7. Users, Profiles, and Quotas

### 7.1 Separate Users by Workload

Use different ClickHouse users:

```text
dashboard_user
ingestion_user
export_user
bi_user
admin_user
report_user
```

### 7.2 Profiles

Profiles set limits/settings.

Dashboard profile:

```text
short max_execution_time
bounded memory
bounded result rows
readonly
```

Export profile:

```text
longer max_execution_time
lower concurrency
streaming
```

BI profile:

```text
strict memory/read limits
readonly
```

Ingestion profile:

```text
insert permissions
insert-focused settings
```

### 7.3 Quotas

Quotas protect cluster from:

- one user scanning too much;
- runaway BI;
- broken app loop;
- tenant abuse.

### 7.4 Principle

Do not use one superuser for all applications.

---

## 8. Logging Configuration

Important logs:

- query log;
- query thread log;
- part log;
- trace log;
- text logs;
- error log;
- asynchronous metric log;
- metric log;
- OpenTelemetry tracing if configured.

### 8.1 Query Log

Enable and retain enough for incident investigation.

Fields help answer:

- who ran query;
- when;
- duration;
- read rows/bytes;
- memory;
- error;
- query_id.

### 8.2 Part Log

Useful for parts lifecycle, merges, mutations.

### 8.3 Retention

System logs themselves can grow. Define retention/TTL.

### 8.4 Export Logs to Monitoring

Collect logs centrally.

Do not rely on SSHing into node during incident.

---

## 9. Core System Tables for Operations

### 9.1 Health

```sql
SELECT version(), uptime();
```

### 9.2 Running Queries

```sql
SELECT
    query_id,
    user,
    elapsed,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    formatReadableSize(memory_usage) AS memory,
    query
FROM system.processes
ORDER BY elapsed DESC;
```

### 9.3 Recent Slow Queries

```sql
SELECT
    event_time,
    query_id,
    user,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    formatReadableSize(memory_usage) AS memory,
    result_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY query_duration_ms DESC
LIMIT 20;
```

### 9.4 Active Parts

```sql
SELECT
    database,
    table,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY parts DESC;
```

### 9.5 Parts by Partition

```sql
SELECT
    database,
    table,
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY parts DESC
LIMIT 50;
```

### 9.6 Merges

```sql
SELECT
    database,
    table,
    partition_id,
    elapsed,
    progress,
    num_parts,
    formatReadableSize(total_size_bytes_compressed) AS total_size
FROM system.merges
ORDER BY elapsed DESC;
```

### 9.7 Mutations

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    parts_to_do,
    latest_fail_reason
FROM system.mutations
ORDER BY create_time DESC;
```

### 9.8 Replicas

```sql
SELECT
    database,
    table,
    is_readonly,
    is_session_expired,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    part_mutations_in_queue,
    absolute_delay,
    active_replicas,
    total_replicas
FROM system.replicas;
```

### 9.9 Replication Queue

```sql
SELECT
    database,
    table,
    replica_name,
    type,
    create_time,
    now() - create_time AS age,
    num_tries,
    last_exception
FROM system.replication_queue
ORDER BY age DESC
LIMIT 100;
```

### 9.10 Distribution Queue

```sql
SELECT
    database,
    table,
    count() AS pending_files,
    min(create_time) AS oldest
FROM system.distribution_queue
GROUP BY database, table
ORDER BY pending_files DESC;
```

---

## 10. Metrics to Monitor

### 10.1 Host Metrics

- CPU utilization;
- load average;
- memory usage;
- disk usage;
- disk read/write throughput;
- disk IOPS/latency;
- network throughput;
- network errors;
- filesystem inode usage;
- time sync.

### 10.2 ClickHouse Metrics

- running queries;
- query latency p95/p99;
- query errors;
- read rows/bytes;
- memory usage;
- inserted rows/bytes;
- active parts;
- parts per partition;
- merges running;
- mutation backlog;
- replication lag;
- replication queue size;
- distributed queue backlog;
- Keeper session issues;
- cache hit ratio if applicable;
- background pool utilization.

### 10.3 Pipeline Metrics

- ingestion lag;
- batch size;
- insert latency;
- DLQ count;
- validation errors;
- reconciliation diffs;
- watermark delay.

### 10.4 Product Metrics

- dashboard latency;
- export job duration;
- report generation success;
- data freshness by tenant;
- query family volume.

---

## 11. Alerting Philosophy

Alerts must be actionable.

Bad alert:

```text
CPU > 80%
```

alone can be noisy.

Better:

```text
CPU > 90% for 15m AND query p95 > SLA
```

or:

```text
replication queue age > 10m
```

or:

```text
disk free < 15% and decreasing
```

### 11.1 Alert Severity

P1:

- data unavailable;
- disk almost full;
- all replicas of shard down;
- Keeper unavailable;
- ingestion stopped for critical pipeline;
- official reporting blocked near deadline.

P2:

- replica lag high;
- query latency severe;
- mutation stuck;
- distribution queue growing;
- disk free below warning.

P3:

- slow trend;
- part count increasing;
- cache hit ratio lower;
- backfill delayed.

### 11.2 Alert Should Include Runbook Link

Every alert should answer:

```text
what happened?
why it matters?
what dashboard/query to check?
what runbook to follow?
```

---

## 12. Essential Alerts

### 12.1 Disk Space

Warn:

```text
disk free < 20%
```

Critical:

```text
disk free < 10%
```

Also alert on fast growth.

### 12.2 Too Many Parts

Alert when:

- active parts per table high;
- parts per partition high;
- part count rising quickly.

### 12.3 Replication Lag

Alert when:

- `absolute_delay` exceeds SLO;
- replication queue age high;
- queue size growing;
- replica readonly/session expired.

### 12.4 Keeper

Alert on:

- Keeper unavailable;
- session expirations;
- high latency;
- quorum loss;
- disk full.

### 12.5 Query Errors

Alert on spikes:

- memory limit exceeded;
- timeout;
- too many parts;
- unknown column after deployment;
- network errors.

### 12.6 Mutation Stuck

Alert when mutation unfinished too long or failed reason non-empty.

### 12.7 Distribution Queue

Alert when distributed insert queue backlog grows.

### 12.8 Ingestion Watermark

Alert when data freshness exceeds SLA.

---

## 13. Runbook: Slow Queries

### 13.1 First Questions

1. Is it one query family or all queries?
2. Is cluster generally overloaded?
3. Did data volume grow?
4. Any backfill/mutation/merge?
5. Any deployment/schema change?
6. Is it one tenant?
7. Is it distributed coordinator issue?

### 13.2 Commands

Running queries:

```sql
SELECT
    query_id,
    user,
    elapsed,
    read_rows,
    formatReadableSize(read_bytes),
    formatReadableSize(memory_usage),
    query
FROM system.processes
ORDER BY elapsed DESC;
```

Recent slow:

```sql
SELECT
    event_time,
    query_id,
    user,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes),
    formatReadableSize(memory_usage),
    result_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY query_duration_ms DESC
LIMIT 20;
```

Background:

```sql
SELECT * FROM system.merges;
SELECT * FROM system.mutations WHERE is_done = 0;
```

### 13.3 Immediate Actions

- identify offending query family;
- kill runaway query if harmful;
- throttle API/BI user;
- enable cached/degraded mode;
- pause backfill if causing issue;
- reduce dashboard refresh;
- apply query guardrail.

### 13.4 Long-Term Fix

- optimize query;
- add rollup/projection;
- fix schema/sort key;
- isolate workload;
- add resource if valid workload.

---

## 14. Runbook: Disk Full or Near Full

### 14.1 Why Critical

ClickHouse needs disk for:

- new inserts;
- merges;
- mutations;
- temporary files;
- replication fetches.

If disk fills, system can become unstable.

### 14.2 Check Disk

OS/cloud metrics.

ClickHouse:

```sql
SELECT
    name,
    path,
    formatReadableSize(free_space) AS free,
    formatReadableSize(total_space) AS total,
    formatReadableSize(keep_free_space) AS keep_free
FROM system.disks;
```

Largest tables:

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk)) AS bytes,
    sum(rows) AS rows,
    count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 20;
```

### 14.3 Immediate Actions

- stop/pause backfills;
- stop large mutations;
- reduce ingestion if necessary;
- drop safe old partitions if retention allows;
- move cold data if storage policy exists;
- add disk capacity;
- avoid `OPTIMIZE FINAL` panic.

### 14.4 Dangerous Actions

Do not manually delete data files from filesystem unless you know exact recovery procedure.

Use ClickHouse DDL/TTL/drop partition.

### 14.5 Long-Term Fix

- retention policy;
- TTL;
- storage tiering;
- capacity planning;
- reduce raw retention;
- compress better;
- fix part/merge debt;
- add storage.

---

## 15. Runbook: Too Many Parts

### 15.1 Symptoms

- insert failures;
- slow queries;
- high merge backlog;
- replication queue grows;
- warnings/errors about parts.

### 15.2 Diagnose

```sql
SELECT
    database,
    table,
    partition,
    count() AS parts,
    sum(rows) AS rows,
    round(avg(rows), 2) AS avg_rows_per_part,
    formatReadableSize(avg(bytes_on_disk)) AS avg_part_size
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY parts DESC
LIMIT 50;
```

### 15.3 Causes

- small inserts;
- too many partitions;
- high-cardinality partition key;
- distributed inserts split tiny batches;
- materialized view write amplification;
- backfill tiny chunks.

### 15.4 Immediate Actions

- reduce insert concurrency;
- increase batch size;
- pause bad ingestion source;
- monitor merges;
- avoid creating more tiny parts;
- only consider manual optimize on controlled partitions.

### 15.5 Long-Term Fix

- ingestion batching;
- async insert if appropriate;
- partition redesign;
- batch by partition/shard;
- reduce MV targets;
- backfill using larger chunks.

---

## 16. Runbook: Stuck Mutation

### 16.1 Diagnose

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    parts_to_do,
    latest_failed_part,
    latest_fail_reason
FROM system.mutations
WHERE is_done = 0
ORDER BY create_time;
```

### 16.2 Causes

- huge mutation;
- invalid expression;
- disk/memory pressure;
- replica lag;
- too many parts;
- mutation conflicts;
- data type issue.

### 16.3 Immediate Actions

- check latest_fail_reason;
- estimate impact;
- check disk;
- check replication queue;
- pause additional mutations;
- consider `KILL MUTATION` if safe.

### 16.4 Long-Term Fix

- avoid frequent mutations;
- use partition reload;
- use correction/tombstone;
- model mutable data logically;
- run maintenance windows.

---

## 17. Runbook: Replica Lag

### 17.1 Diagnose

```sql
SELECT
    database,
    table,
    is_readonly,
    is_session_expired,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    part_mutations_in_queue,
    absolute_delay,
    active_replicas,
    total_replicas
FROM system.replicas
ORDER BY absolute_delay DESC;
```

Queue:

```sql
SELECT
    database,
    table,
    type,
    create_time,
    now() - create_time AS age,
    num_tries,
    last_exception
FROM system.replication_queue
ORDER BY age DESC
LIMIT 100;
```

### 17.2 Causes

- network issue;
- disk slow/full;
- source replica unavailable;
- Keeper session issue;
- too many parts;
- mutation backlog;
- fetch failure.

### 17.3 Immediate Actions

- check disk/network/Keeper;
- inspect last_exception;
- pause backfill if causing pressure;
- ensure at least one healthy replica per shard;
- avoid reading stale replicas if freshness critical.

### 17.4 Long-Term Fix

- fix ingestion small parts;
- capacity upgrade;
- network/Keeper stability;
- reduce mutations;
- improve monitoring.

---

## 18. Runbook: Keeper/ZooKeeper Issues

### 18.1 Symptoms

- replicas readonly;
- session expired;
- inserts fail on replicated tables;
- replication stalls;
- DDL on cluster stuck.

### 18.2 Check

- Keeper node health;
- quorum;
- disk space;
- latency;
- connection count;
- ClickHouse logs;
- `system.replicas` session fields.

### 18.3 Immediate Actions

- restore Keeper quorum;
- avoid restarting all ClickHouse nodes blindly;
- pause heavy DDL/mutations;
- verify replicated tables after recovery.

### 18.4 Long-Term Fix

- HA Keeper ensemble;
- monitor latency/disk/session;
- isolate Keeper workload;
- backup/snapshot strategy;
- documented recovery.

---

## 19. Runbook: Distributed Insert Queue Backlog

### 19.1 Diagnose

```sql
SELECT
    database,
    table,
    count() AS pending_files,
    min(create_time) AS oldest
FROM system.distribution_queue
GROUP BY database, table
ORDER BY pending_files DESC;
```

### 19.2 Causes

- remote shard unavailable;
- network issue;
- auth/config mismatch;
- target table missing/schema drift;
- remote disk full;
- insert rate too high.

### 19.3 Immediate Actions

- check remote shard health;
- check target table schema;
- check network;
- check errors in logs;
- pause ingestion if backlog growing uncontrollably.

### 19.4 Long-Term Fix

- app-side routing or better insert architecture;
- robust cluster config;
- monitor distributed queue;
- idempotent retry.

---

## 20. Runbook: Schema Drift

### 20.1 Symptoms

- query works on one node, fails on another;
- unknown column;
- type mismatch;
- insert fails randomly;
- distributed query fails.

### 20.2 Diagnose

```sql
SELECT
    hostName() AS host,
    name,
    type,
    default_kind,
    default_expression
FROM clusterAllReplicas('analytics_cluster', system, columns)
WHERE database = 'analytics'
  AND table = 'events_local'
ORDER BY host, position;
```

### 20.3 Causes

- DDL not run `ON CLUSTER`;
- node down during DDL;
- manual DDL;
- app deployed before DDL completed;
- old restored replica.

### 20.4 Fix

- apply missing DDL;
- verify all nodes;
- pause app feature using column until complete;
- improve migration automation.

---

## 21. Runbook: Ingestion Lag

### 21.1 Symptoms

- dashboard stale;
- watermark old;
- Kafka lag increasing;
- no recent rows.

### 21.2 Check

- source producer;
- Kafka lag;
- ingestion service logs;
- batch insert latency;
- DLQ;
- ClickHouse insert errors;
- distribution/replication queue;
- part count;
- disk.

### 21.3 Immediate Actions

- identify source/partition;
- pause problematic data if poison;
- fix schema error;
- throttle if ClickHouse overloaded;
- replay once fixed.

### 21.4 Long-Term Fix

- validation;
- DLQ monitoring;
- schema registry;
- idempotent replay;
- ingestion capacity.

---

## 22. Maintenance Operations

### 22.1 Routine Maintenance

- review disk growth;
- review part counts;
- review slow query families;
- review failed queries;
- review mutation history;
- review replica lag;
- review Keeper health;
- validate backups;
- test restore periodically;
- review users/permissions;
- upgrade planning.

### 22.2 Avoid Peak-Hour Heavy Work

Schedule:

- backfills;
- large mutations;
- table rebuilds;
- rollup rebuilds;
- major exports;
- schema migrations requiring rewrite.

### 22.3 Change Management

For production changes:

- change ticket;
- impact assessment;
- rollback plan;
- monitoring during change;
- post-change validation.

---

## 23. Upgrade Strategy

### 23.1 Why Care

ClickHouse evolves quickly. Upgrades bring:

- features;
- bug fixes;
- performance improvements;
- behavior changes;
- deprecations.

### 23.2 Upgrade Plan

1. Read release notes.
2. Test in staging with production-like queries.
3. Validate client/driver compatibility.
4. Validate DDL/materialized views/dictionaries.
5. Backup before upgrade.
6. Upgrade one replica/node at a time if cluster.
7. Monitor replication/query errors.
8. Run smoke tests.
9. Complete rollout.
10. Document changes.

### 23.3 Avoid

- jumping many versions without testing;
- upgrading during major backfill;
- changing schema and version simultaneously;
- ignoring Java driver compatibility.

### 23.4 Rollback

Rollback may not always be simple if data format/metadata changed. Understand version compatibility before upgrade.

---

## 24. Capacity and Growth Review

### 24.1 Weekly/Monthly Review

Track:

- data growth per table;
- parts growth;
- query volume by family;
- top expensive queries;
- storage forecast;
- ingestion throughput;
- replication lag incidents;
- failed queries;
- export usage;
- BI usage.

### 24.2 Forecast

Estimate:

```text
days until disk warning
days until retention boundary
growth by tenant/source
query growth
```

### 24.3 Table Ownership

Every major table should have owner:

- business owner;
- technical owner;
- retention;
- SLA;
- data classification;
- query families;
- backfill owner.

### 24.4 Cost Review

Especially cloud:

- compute usage;
- storage;
- object storage requests;
- network egress;
- idle compute;
- expensive exports.

---

## 25. Workload Management

### 25.1 User/Profile Isolation

Separate:

- dashboard;
- export;
- BI;
- ingestion;
- admin.

### 25.2 Time-Based Scheduling

Run heavy jobs off-peak.

### 25.3 Query Guardrails

At app and DB level.

### 25.4 Kill/Throttle Policy

Define who can:

- kill queries;
- pause ingestion;
- pause export workers;
- stop backfill;
- apply emergency limits.

### 25.5 Dashboard Degraded Mode

Application should support:

- cached data;
- freshness warning;
- temporarily disabled heavy widgets;
- async report mode.

---

## 26. Observability Dashboard Layout

Create dashboards for:

### 26.1 Cluster Overview

- node up/down;
- CPU/memory/disk/network;
- ClickHouse uptime;
- query QPS;
- p95 query latency;
- error rate.

### 26.2 Storage/Parts

- disk usage by node;
- active parts by table;
- parts per partition;
- table sizes;
- merge activity.

### 26.3 Ingestion

- rows/sec;
- insert latency;
- batch size;
- ingestion lag;
- DLQ;
- distribution queue.

### 26.4 Replication

- replica lag;
- queue size;
- readonly replicas;
- active replicas;
- replication errors.

### 26.5 Queries

- slow queries;
- heavy read bytes;
- high memory queries;
- query families;
- BI usage;
- result bytes.

### 26.6 Background Work

- merges;
- mutations;
- TTL operations;
- backups.

---

## 27. Incident Management

### 27.1 Severity Examples

P1:

```text
critical dashboards unavailable
data ingestion stopped for core pipeline
disk critical
all replicas of shard down
Keeper quorum lost
```

P2:

```text
one replica lagging
query latency degraded
export stuck
rollup stale
```

P3:

```text
part count trend high
noncritical BI failures
capacity forecast warning
```

### 27.2 Incident Roles

- Incident commander.
- ClickHouse operator.
- Application owner.
- Ingestion owner.
- SRE/platform.
- Data owner.

### 27.3 During Incident

- stabilize first;
- stop harmful workload;
- preserve evidence;
- avoid unsafe manual file changes;
- communicate freshness/impact;
- document commands run.

### 27.4 Postmortem

Capture:

- timeline;
- impact;
- root cause;
- detection gap;
- runbook gaps;
- prevention actions;
- owner and deadline.

---

## 28. Example Operational Scenarios

### 28.1 BI User Causes Cluster Overload

Immediate:

- identify user/query;
- kill query if needed;
- apply profile limits;
- route BI to separate workload.

Long term:

- semantic dataset;
- quotas;
- training;
- rollups;
- separate compute.

### 28.2 Backfill Creates Too Many Parts

Immediate:

- pause backfill;
- check parts;
- allow merges;
- increase batch size.

Long term:

- manifest-based partition backfill;
- batch by partition/shard;
- shadow table;
- schedule off-peak.

### 28.3 Dashboard Stale

Immediate:

- check watermark;
- check ingestion;
- check MV/rollup;
- check replica lag.

Long term:

- freshness metadata;
- alerting;
- reconciliation;
- robust ingestion.

### 28.4 Disk Growth Unexpected

Immediate:

- identify largest table/partition;
- stop unnecessary backfill/export;
- apply safe retention if possible.

Long term:

- TTL;
- capacity forecast;
- storage tiering;
- data owner review.

---

## 29. Operational Anti-Patterns

### 29.1 No Query Limits

One bad query can hurt everyone.

### 29.2 No Runbooks

On-call improvises under pressure.

### 29.3 Manual Config Edits

Config drift.

### 29.4 Ignoring Part Count

Disk may be fine but parts unhealthy.

### 29.5 Blind OPTIMIZE FINAL

Can worsen incident.

### 29.6 Killing Random Queries Without Context

May break official report/export/backfill.

### 29.7 No Restore Test

Backup is only a theory.

### 29.8 All Workloads Same User

No isolation, no attribution.

### 29.9 No Freshness Monitoring

Users discover stale data first.

### 29.10 Treating ClickHouse as Stateless

It is stateful and background-work-heavy.

---

## 30. Production Operating Model

### 30.1 Ownership Matrix

| Area | Owner |
|---|---|
| schema design | data/backend team |
| ingestion pipeline | platform/data engineering |
| ClickHouse cluster | data platform/SRE |
| analytics API | backend team |
| dashboard query families | product/backend/data |
| security/access | security/platform |
| backups/DR | SRE/data platform |
| report correctness | business/data owner |

### 30.2 RACI Example

For table `case_lifecycle_events`:

- Responsible: case analytics team.
- Accountable: data platform lead.
- Consulted: regulatory reporting owner.
- Informed: SRE/security.

### 30.3 Operational Docs

Each production table should document:

- purpose;
- owner;
- schema;
- retention;
- source pipeline;
- query families;
- SLA;
- backfill process;
- reconciliation;
- runbook.

---

## 31. Exercises

### Exercise 1: Disk Alert

Disk free is 8%.

What do you do first?

Expected:

```text
Stop heavy backfills/mutations, identify largest tables/partitions, check safe retention/drop partition, add capacity. Do not manually delete files or run OPTIMIZE FINAL.
```

### Exercise 2: Too Many Parts

Table has 100k active parts.

Expected diagnosis:

```text
small inserts/over-partitioning/backfill/MV write amplification.
```

Immediate:

```text
pause source, increase batching, monitor merges.
```

### Exercise 3: Query Works on One Node Not Another

Likely:

```text
schema/config drift or replica lag.
```

Check:

```text
system.columns across cluster, system.clusters, system.replicas.
```

### Exercise 4: Dashboard Stale But Raw Has Data

Likely:

```text
rollup/MV lag, query reads stale replica, dashboard uses wrong table/cache, watermark mismatch.
```

### Exercise 5: BI Overload

Expected:

```text
identify user/query, kill if needed, apply BI profile limits, create semantic/rollup dataset, isolate workload.
```

---

## 32. Summary

Operating ClickHouse well means watching more than query latency.

Core principles:

1. ClickHouse is stateful and background-work-heavy.
2. Healthy server is not enough; parts, merges, mutations, replicas, and queues must be healthy.
3. Config must be managed as code.
4. Users/profiles/quotas are operational safety tools.
5. Alerts must be actionable and tied to runbooks.
6. Too many parts is one of the most important production smells.
7. Disk headroom is critical.
8. Replication/Keeper health affects correctness and availability.
9. Workload isolation prevents dashboards, exports, BI, and backfills from hurting each other.
10. Upgrades require testing and rollout discipline.
11. Every table/pipeline needs ownership and runbook.
12. Restore tests matter more than backup configuration.

Practical sentence:

> A production ClickHouse cluster is healthy only when foreground queries and background maintenance can both make progress safely.

---

## 33. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment:

1. ClickHouse Docs — Server configuration.
2. ClickHouse Docs — Users and roles.
3. ClickHouse Docs — Settings profiles.
4. ClickHouse Docs — Quotas.
5. ClickHouse Docs — Monitoring.
6. ClickHouse Docs — system tables.
7. ClickHouse Docs — system.query_log.
8. ClickHouse Docs — system.parts.
9. ClickHouse Docs — system.merges.
10. ClickHouse Docs — system.mutations.
11. ClickHouse Docs — system.replicas.
12. ClickHouse Docs — system.replication_queue.
13. ClickHouse Docs — Distributed table engine.
14. ClickHouse Docs — ClickHouse Keeper.
15. ClickHouse Docs — Backups.
16. ClickHouse Docs — Troubleshooting.
17. ClickHouse Docs — Kubernetes operator if applicable.
18. ClickHouse Docs — Cloud monitoring if using ClickHouse Cloud.

---

## 34. Status Seri

Part ini adalah:

```text
Part 030 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 031 — Operations II: Security, Governance, Privacy, Access Control, and Compliance
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Production Ingestion Pipelines: Kafka, CDC, Backfills, Validation, and Reconciliation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-031.md">Part 031 — Operations II: Security, Governance, Privacy, Access Control, and Compliance ➡️</a>
</div>

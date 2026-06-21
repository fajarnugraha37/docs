# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-032.md

# Part 032 — Operations III: Backup, Restore, Disaster Recovery, Migration, and Upgrade Playbooks

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **032 / 034**  
> Fokus: memastikan data ClickHouse bisa dipulihkan: backup strategy, restore testing, disaster recovery, migration, replication-aware restore, object storage, replay, upgrade playbooks, and operational validation.

---

## 0. Posisi Part Ini Dalam Seri

Part 030 membahas operasi umum:

- deployment;
- configuration;
- monitoring;
- alerting;
- runbooks;
- upgrade awareness.

Part 031 membahas security dan governance:

- users;
- roles;
- quotas;
- row policies;
- PII;
- audit;
- retention;
- compliance.

Part 032 ini membahas salah satu topik paling kritis untuk sistem stateful:

> backup, restore, disaster recovery, migration, and upgrade.

Banyak tim berkata:

```text
kami punya backup
```

Padahal yang lebih penting adalah:

```text
kami pernah restore backup itu
kami tahu RPO/RTO
kami tahu data apa yang tidak masuk backup
kami tahu cara restore distributed cluster
kami tahu cara rebuild derived tables
kami tahu cara replay source data
kami tahu cara validasi hasil restore
kami tahu siapa yang memutuskan failover
```

Backup yang tidak pernah diuji adalah asumsi, bukan proteksi.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan backup, snapshot, replication, archive, and replay;
2. mendesain backup strategy berdasarkan RPO/RTO;
3. memahami apa yang harus dibackup: data, metadata, DDL, users, config, dictionaries, Keeper metadata, object storage, report artifacts;
4. memahami perbedaan backup single-node, replicated, distributed, and cloud-native ClickHouse;
5. mendesain restore workflow yang aman;
6. melakukan restore validation dengan counts, checksums, watermarks, and query comparison;
7. memahami disaster recovery scenarios: node loss, disk loss, shard loss, region loss, accidental delete, bad mutation, bad deployment;
8. merancang replay dari Kafka/object storage/raw events;
9. melakukan migration ke cluster baru atau versi baru;
10. merancang upgrade playbook yang tidak merusak ingestion/query/report;
11. memahami rollback limits;
12. membuat runbook dan checklist untuk backup/restore/DR.

---

## 2. Mental Model Utama: Replication Is Not Backup

Salah satu miskonsepsi terbesar:

```text
kami punya 2 replicas, berarti sudah punya backup
```

Salah.

Replication melindungi dari:

- node failure;
- disk failure pada satu replica;
- maintenance;
- availability.

Replication tidak selalu melindungi dari:

- accidental DROP TABLE;
- bad ALTER DELETE;
- bad mutation;
- corrupted data propagated;
- duplicate backfill;
- malicious delete;
- application bug inserting wrong data;
- schema migration mistake;
- region-wide outage;
- ransomware/credential compromise;
- logical error in rollup/report.

Jika kamu menghapus data dari replicated table, deletion/mutation bisa menyebar ke replicas.

Backup menjawab:

```text
bisakah kita kembali ke kondisi sebelumnya?
```

Replication menjawab:

```text
bisakah sistem tetap tersedia saat salah satu copy/node gagal?
```

Keduanya berbeda.

---

## 3. Key Concepts: RPO and RTO

### 3.1 RPO — Recovery Point Objective

RPO menjawab:

```text
berapa banyak data maksimal boleh hilang?
```

Examples:

| System | RPO |
|---|---|
| product analytics dashboard | 15 minutes |
| audit events | near zero / source replay |
| regulatory report snapshots | zero after publication |
| raw logs | 1 hour acceptable |
| BI derived tables | rebuildable from raw |

### 3.2 RTO — Recovery Time Objective

RTO menjawab:

```text
berapa lama sistem boleh down sampai pulih?
```

Examples:

| System | RTO |
|---|---|
| internal BI | 1 day |
| operational dashboard | 1 hour |
| security monitoring | 15 minutes |
| official reporting near deadline | few hours |
| ingestion pipeline | depends buffering |

### 3.3 RPO/RTO Drive Architecture

If RPO near zero:

- durable source log;
- Kafka retention;
- object storage archive;
- frequent backups;
- idempotent replay;
- report snapshots.

If RTO low:

- replicas;
- standby cluster;
- tested restore automation;
- DNS/client failover;
- pre-warmed compute;
- runbooks.

---

## 4. What Needs Protection?

### 4.1 ClickHouse Table Data

- raw events;
- refined events;
- rollups;
- current snapshots;
- report snapshots;
- audit events;
- ingestion metadata;
- watermarks;
- reconciliation history.

### 4.2 Metadata and DDL

- database definitions;
- table DDL;
- materialized view DDL;
- projections;
- dictionaries;
- functions;
- users/roles/grants;
- settings profiles;
- quotas;
- row policies;
- storage policies.

### 4.3 Configuration

- server config;
- users config if file-based;
- cluster config;
- macros;
- remote_servers;
- Keeper config;
- object storage config;
- TLS certificates;
- secrets references.

### 4.4 Keeper/ZooKeeper Metadata

For replicated tables, Keeper stores coordination metadata.

This is not table data itself, but it is important for replicated state.

### 4.5 External Dependencies

- Kafka topics/retention;
- schema registry;
- object storage raw archive;
- export files;
- report artifacts;
- application DB export job metadata;
- orchestration configs;
- IaC.

### 4.6 Derived Data

Rollups and materialized views may be rebuildable.

Decide:

```text
backup derived tables
or rebuild from raw?
```

For small/critical report snapshots, backup them directly.

---

## 5. Data Classification for Backup Strategy

Not all data needs same backup method.

### 5.1 Raw Source-of-Truth Events

Critical if not replayable elsewhere.

Strategy:

- backup table;
- archive raw events to object storage;
- Kafka retention enough for short replay;
- immutable event ID.

### 5.2 Derived Rollups

Can often be rebuilt from raw.

Strategy:

- maybe backup if rebuild expensive;
- document rebuild process;
- validate raw availability.

### 5.3 Current Snapshot

May be rebuildable from CDC/event history.

Strategy:

- backup or rebuild from raw CDC/events;
- keep source ordering/version.

### 5.4 Official Reports

Must be backed up and versioned.

Strategy:

- backup report snapshot table;
- export report artifact;
- checksum;
- legal retention.

### 5.5 Logs/Traces

May have lower RPO/RTO depending business.

Strategy:

- short retention;
- object storage archive if required;
- accept loss if documented.

### 5.6 Audit Events

High criticality.

Strategy:

- strong backup;
- immutable archive;
- access controls;
- retention policy.

---

## 6. Backup Types

### 6.1 Full Backup

All selected data/metadata.

Pros:

- simple restore semantics;
- complete point.

Cons:

- expensive;
- slow;
- large.

### 6.2 Incremental Backup

Only changes since prior backup.

Pros:

- efficient;
- frequent.

Cons:

- restore chain complexity;
- requires careful validation.

### 6.3 Snapshot

Storage-level snapshot or database backup at a point.

Pros:

- fast if supported;
- useful for large data.

Cons:

- may be storage-specific;
- consistency depends implementation.

### 6.4 Logical Export

Export table data as formats:

- Native;
- Parquet;
- CSV;
- JSONEachRow.

Pros:

- portable;
- useful migration.

Cons:

- slower;
- type fidelity concerns;
- large exports costly.

### 6.5 Replay-Based Recovery

Rebuild from source:

- Kafka;
- object storage raw archive;
- CDC logs;
- OLTP snapshot + CDC.

Pros:

- strong correctness if source durable;
- flexible.

Cons:

- slow;
- requires idempotent pipeline;
- source retention must be enough.

### 6.6 Hybrid

Most production systems need hybrid:

```text
backups for fast restore
+ source archive for replay
+ derived rebuild scripts
+ report snapshots for official artifacts
```

---

## 7. ClickHouse Backup Approaches

### 7.1 Native BACKUP / RESTORE

ClickHouse supports `BACKUP` and `RESTORE` statements in modern versions.

Conceptual example:

```sql
BACKUP TABLE analytics.case_lifecycle_events
TO Disk('backups', 'case_lifecycle_events_20260621.zip');
```

or backup database.

Restore:

```sql
RESTORE TABLE analytics.case_lifecycle_events
FROM Disk('backups', 'case_lifecycle_events_20260621.zip');
```

Exact destination syntax and supported backends depend on version/config.

### 7.2 Filesystem/Volume Snapshot

Use storage-level snapshot:

- cloud volume snapshot;
- LVM snapshot;
- filesystem snapshot.

Needs consistency planning.

### 7.3 Object Storage Backup

Backup to S3-compatible storage.

Good for:

- off-node durability;
- cross-region copy;
- long retention.

### 7.4 Third-Party Tools

There are ecosystem tools for ClickHouse backup automation. If using, evaluate:

- version compatibility;
- restore behavior;
- replicated cluster support;
- incremental support;
- object storage support;
- encryption;
- verification;
- operational maturity.

### 7.5 Managed Cloud Backups

If using ClickHouse Cloud/managed provider:

- understand backup schedule;
- retention;
- restore process;
- PITR support if any;
- what is included/excluded;
- how long restore takes;
- cross-region options;
- export/backup ownership.

Do not assume managed means all business DR requirements are met.

---

## 8. Backup Scope Design

### 8.1 Table Selection

Classify tables:

```text
must backup:
  audit_events
  official_report_snapshots
  raw critical events
  ingestion metadata
  watermarks
  governance metadata

can rebuild:
  daily rollups
  current snapshots
  top-N tables

optional:
  short-retention logs
  temporary staging
```

### 8.2 Metadata Backup

Always backup/export DDL:

```sql
SHOW CREATE TABLE analytics.case_lifecycle_events;
SHOW CREATE DATABASE analytics;
```

Also store in Git/IaC.

### 8.3 Access Control Backup

Export:

- users;
- roles;
- grants;
- row policies;
- profiles;
- quotas.

If config-file based, backup config repository and deployed secrets separately.

### 8.4 Config Backup

Keep all configs in version control.

Sensitive values should be references to secret manager, not plaintext.

### 8.5 Keeper Metadata

If self-managed replicated ClickHouse, backup/restore strategy must include Keeper/ZooKeeper procedures.

Often safest disaster recovery relies on restoring table data and recreating replication metadata carefully, not blindly copying partial state without understanding.

---

## 9. Backup Frequency

Frequency depends on RPO.

Example schedule:

| Data | Backup Frequency |
|---|---|
| report snapshots | immediately after generation + daily |
| audit events | frequent / continuous archive |
| raw events | hourly/daily + source archive |
| rollups | daily or rebuild |
| current state | daily or rebuild |
| configs/DDL | every change |
| access control | every change/daily |
| logs | optional/daily if required |

### 9.1 Backup After Major Changes

Run backup before:

- major migration;
- large mutation;
- table rebuild;
- version upgrade;
- partition drop;
- schema redesign;
- report period close.

### 9.2 Backup Retention

Define:

- daily retained 7/14/30 days;
- weekly retained N weeks;
- monthly retained N months;
- legal retention for reports/audit.

Align with cost and compliance.

---

## 10. Restore Testing

### 10.1 Backup Is Not Real Until Restored

A backup plan must include periodic restore test.

Test:

```text
backup → restore to isolated environment → validate queries
```

### 10.2 Restore Test Levels

#### Level 1: Metadata Only

Can recreate schema/users/config?

#### Level 2: Single Table Restore

Restore one table and validate row count/checksum.

#### Level 3: Database Restore

Restore multiple related tables.

#### Level 4: Cluster Restore

Restore distributed/replicated cluster.

#### Level 5: Full DR Exercise

Simulate region/cluster loss and run application against restored system.

### 10.3 Restore Validation

Validate:

- row counts;
- min/max event_time;
- checksums;
- sample queries;
- rollup vs raw;
- report checksum;
- permissions;
- materialized views;
- application smoke tests;
- ingestion resumes.

### 10.4 Restore Test Frequency

For critical systems:

- at least quarterly;
- after major schema/backup tooling changes;
- before regulatory deadlines;
- after infrastructure changes.

---

## 11. Restore Validation Queries

### 11.1 Row Counts by Partition

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE database = 'analytics'
  AND table = 'case_lifecycle_events'
  AND active
GROUP BY partition
ORDER BY partition;
```

### 11.2 Business Counts

```sql
SELECT
    toDate(event_time) AS day,
    event_type,
    count() AS events
FROM analytics.case_lifecycle_events
GROUP BY
    day,
    event_type
ORDER BY day, event_type;
```

Compare with pre-backup baseline.

### 11.3 Checksum-Like Validation

For deterministic fields:

```sql
SELECT
    cityHash64(
        groupArray(
            cityHash64(tenant_id, event_id, event_time, event_type)
        )
    ) AS checksum
FROM
(
    SELECT
        tenant_id,
        event_id,
        event_time,
        event_type
    FROM analytics.case_lifecycle_events
    WHERE event_time >= '2026-06-01'
      AND event_time < '2026-07-01'
    ORDER BY tenant_id, event_id
);
```

For huge data, compute partition-level checksum instead of full groupArray if memory risk.

### 11.4 Rollup vs Raw

```sql
WITH raw AS
(
    SELECT
        toDate(event_time) AS day,
        countIf(event_type = 'CASE_OPENED') AS opened
    FROM analytics.case_lifecycle_events
    GROUP BY day
),
roll AS
(
    SELECT
        day,
        sum(opened_count) AS opened
    FROM analytics.daily_case_lifecycle_rollup
    GROUP BY day
)
SELECT
    raw.day,
    raw.opened,
    roll.opened,
    raw.opened - roll.opened AS diff
FROM raw
FULL OUTER JOIN roll USING day
ORDER BY day;
```

### 11.5 Report Snapshot Check

```sql
SELECT
    report_period,
    report_version,
    checksum,
    count()
FROM analytics.official_case_report_snapshots
GROUP BY
    report_period,
    report_version,
    checksum
ORDER BY report_period, report_version;
```

---

## 12. Single-Node Restore

### 12.1 Scenario

Node lost disk. Need restore to same/new node.

### 12.2 Steps

1. Provision node.
2. Install same/compatible ClickHouse version.
3. Apply config.
4. Restore metadata/users.
5. Restore table/database backup.
6. Validate system tables.
7. Run business validation queries.
8. Resume ingestion/query traffic.
9. Monitor.

### 12.3 Key Risks

- version mismatch;
- path/storage policy mismatch;
- missing config;
- missing users/grants;
- insufficient disk;
- query service points to old node.

---

## 13. Replicated Table Restore

### 13.1 Understand Replication State

For `ReplicatedMergeTree`, data exists on replicas and metadata in Keeper.

Restoring incorrectly can create:

- duplicate replica paths;
- metadata mismatch;
- readonly replicas;
- missing parts;
- conflicts.

### 13.2 Replica Loss but Other Replica Healthy

If one replica lost data and other replica healthy:

- safest may be to reinitialize/recreate replica and let it fetch parts;
- ensure Keeper metadata correct;
- monitor replication queue;
- do not restore stale data over healthy replica casually.

### 13.3 All Replicas Lost

Need restore from backup.

Steps conceptually:

1. stop writes;
2. restore data/schema;
3. restore/recreate replication metadata carefully;
4. bring replicas back one by one;
5. validate part consistency;
6. resume traffic.

Exact steps depend on topology/version/backup method. Use tested runbook.

### 13.4 Avoid

- copying random data directories between replicas without understanding;
- reusing same replica name;
- manually editing Keeper metadata under pressure;
- restoring stale backup over fresh surviving replica.

---

## 14. Distributed Cluster Restore

### 14.1 Shards Are Logical Data Partitions

In distributed cluster:

```text
shard 1 owns subset A
shard 2 owns subset B
shard 3 owns subset C
```

Restoring must preserve shard data assignment.

### 14.2 Backup Per Shard

Backup local tables per shard.

If each shard has replicas, backup one replica per shard may be enough if consistent and healthy, but validate your strategy.

### 14.3 Restore Order

1. restore/configure Keeper if needed;
2. restore local tables per shard;
3. restore replicated state;
4. restore distributed tables;
5. verify cluster config;
6. validate row counts by shard;
7. run distributed query validation.

### 14.4 Shard Count Change During Restore

If restoring to different shard count, it becomes migration/resharding, not simple restore.

Requires:

- new sharding plan;
- data redistribution;
- validation;
- cutover.

### 14.5 Validate Distributed Completeness

```sql
SELECT
    hostName() AS host,
    count()
FROM clusterAllReplicas('analytics_cluster', analytics, case_lifecycle_events_local)
GROUP BY host
ORDER BY host;
```

And distributed:

```sql
SELECT count()
FROM analytics.case_lifecycle_events;
```

---

## 15. Object Storage and Cloud-Native Restore

### 15.1 Object Storage as Data Location

If table data lives in object storage:

- durable data may survive compute loss;
- restore may focus on metadata/control plane/config;
- cache can be rebuilt.

But deletion/corruption/logical errors still matter.

### 15.2 Backups Still Needed

Object storage durability does not protect from:

- accidental table drop;
- logical deletion;
- bad mutation;
- bad overwrite;
- compromised credential;
- wrong lifecycle policy.

### 15.3 Cloud Managed Restore

Understand provider:

- can restore entire service or table?
- point-in-time available?
- restore to new service or same service?
- how long?
- cross-region?
- what happens to users/roles?
- what happens to integrations?

### 15.4 Export Critical Reports

For official/compliance artifacts, store independent report snapshots/artifacts with checksums.

---

## 16. Disaster Recovery Scenarios

### 16.1 Node Failure

Mitigation:

- replicas;
- restore from backup;
- reinitialize replica;
- load balancer removes node.

### 16.2 Disk Failure

Mitigation:

- replica rebuild;
- backup restore;
- disk replacement;
- validate parts.

### 16.3 Shard Loss

Impact:

- subset of data unavailable/lost.

Mitigation:

- backups per shard;
- restore shard;
- source replay;
- DR cluster.

### 16.4 Keeper Failure

Impact:

- replication/DDL coordination affected.

Mitigation:

- HA Keeper;
- backup/snapshot;
- tested recovery.

### 16.5 Region Loss

Mitigation:

- cross-region backup;
- object storage replication;
- standby cluster;
- source replay;
- DNS/client failover.

### 16.6 Accidental Drop/Mutation

Mitigation:

- backup before destructive changes;
- role restrictions;
- snapshot/backup restore;
- raw replay/rebuild;
- mutation avoidance.

### 16.7 Bad Backfill

Mitigation:

- manifest;
- shadow table;
- batch IDs;
- partition reload;
- rollup rebuild.

### 16.8 Compromised Credentials

Mitigation:

- least privilege;
- audit logs;
- backups protected by separate credentials;
- immutable backup/object lock if required.

---

## 17. DR Architecture Patterns

### 17.1 Backup-Only DR

```text
restore from backup when disaster happens
```

Pros:

- cheaper.

Cons:

- higher RTO.

### 17.2 Warm Standby

```text
secondary cluster exists
data restored periodically or replicated/replayed
```

Pros:

- lower RTO.

Cons:

- cost and complexity.

### 17.3 Active-Active / Multi-Region

Harder.

Potential issues:

- write routing;
- data consistency;
- duplicate ingestion;
- cross-region latency;
- conflict resolution.

Often unnecessary for analytics unless business requires.

### 17.4 Replay-Based DR

```text
raw events archived
new cluster rebuilt by replay
```

Good if RTO allows.

### 17.5 Critical Snapshot DR

For official reports:

```text
report snapshot and artifact replicated to secure storage
```

Even if raw analytics cluster down, official artifacts survive.

---

## 18. Replay Strategy

### 18.1 Sources

- Kafka retained topics;
- object storage raw events;
- CDC logs;
- OLTP snapshot;
- report generation source files.

### 18.2 Requirements

Replay must be:

- idempotent;
- ordered where needed;
- schema-version aware;
- partitioned;
- observable;
- checkpointed.

### 18.3 Replay Table Strategy

Options:

1. replay directly into final raw table;
2. replay into shadow table and swap;
3. replay partition by partition;
4. replay into refined/serving tables after raw.

### 18.4 Replay Validation

Validate:

- expected row counts;
- event_id uniqueness;
- source offsets;
- min/max event_time;
- raw vs rollup;
- sample business queries.

### 18.5 Replay Time

Estimate replay throughput.

If raw data is 500 TB and replay speed is 2 TB/hour:

```text
full replay = 250 hours
```

Too slow for low RTO. Need backups/warm standby.

---

## 19. Migration Playbooks

### 19.1 Migration Types

- single node to cluster;
- self-managed to cloud;
- cluster to new hardware;
- local disk to object storage;
- schema redesign;
- sharding key change;
- version upgrade;
- table engine change.

### 19.2 General Migration Pattern

```text
1. Create target schema.
2. Backfill historical data.
3. Validate historical data.
4. Dual-write or CDC sync new data.
5. Compare source and target.
6. Switch reads.
7. Monitor.
8. Stop old writes.
9. Decommission old system later.
```

### 19.3 Shadow Read

Before cutover:

```text
serve from old
also query new in background
compare results
```

### 19.4 Dual Write Risk

Dual write can diverge.

Prefer:

- durable event stream;
- one source consumed by both;
- outbox;
- replayable archive.

### 19.5 Cutover

Plan:

- maintenance window if needed;
- read-only period if necessary;
- DNS/config switch;
- rollback criteria;
- validation queries.

---

## 20. Resharding

### 20.1 Why Reshard?

- data skew;
- cluster growth;
- bad sharding key;
- tenant isolation;
- storage limit.

### 20.2 Why Hard?

Changing shard count changes data placement.

`Distributed` table alone does not magically rebalance existing local parts.

### 20.3 Resharding Strategy

Common approach:

1. create new cluster/tables;
2. define new sharding key;
3. backfill data from old to new;
4. dual-write new data;
5. validate;
6. switch reads;
7. retire old.

### 20.4 Tenant-Based Reshard

If tenant skew, isolate hot tenant:

```text
large tenant → dedicated shard/cluster
small tenants → shared cluster
```

### 20.5 Validation

- total row counts;
- tenant-level counts;
- partition counts;
- metric comparison;
- query latency comparison.

---

## 21. Schema/Table Engine Migration

### 21.1 Changing ORDER BY

You cannot simply alter sort order cheaply for existing data.

Usually:

```text
create new table
insert select from old
validate
swap
```

### 21.2 Changing Partition Key

Same: create new table and reload.

### 21.3 Changing Engine

Example:

```text
MergeTree → ReplacingMergeTree
SummingMergeTree → AggregatingMergeTree
```

Usually requires new table.

### 21.4 Migration Flow

```sql
CREATE TABLE events_v2 (... new design ...);

INSERT INTO events_v2
SELECT ...
FROM events_v1
WHERE partition = ...;

validate;

RENAME TABLE events TO events_old, events_v2 TO events;
```

For distributed/replicated cluster, use `ON CLUSTER` and careful cutover.

### 21.5 Materialized Views

Update/recreate MVs carefully.

MVs can duplicate inserts if both old/new active unexpectedly.

---

## 22. Upgrade Playbook

### 22.1 Before Upgrade

- read release notes;
- check breaking changes;
- check deprecated settings;
- check client/driver compatibility;
- run staging tests;
- backup critical data;
- freeze heavy backfills/mutations;
- define rollback plan;
- notify stakeholders.

### 22.2 Staging Test

Run:

- representative queries;
- inserts;
- materialized views;
- mutations;
- backups/restores;
- Java integration tests;
- BI smoke tests;
- report generation.

### 22.3 Rolling Upgrade

For cluster:

1. upgrade one replica at a time;
2. monitor replica health;
3. ensure no replication lag explosion;
4. test queries;
5. continue.

### 22.4 Upgrade Keeper

If Keeper/ZooKeeper upgrade involved, plan separately.

Coordination service failure affects replicated tables.

### 22.5 After Upgrade

- monitor errors;
- compare query latency;
- check system tables;
- check replication;
- run smoke tests;
- validate backups still work.

### 22.6 Rollback Warning

Rollback may be limited if new version changes data/metadata format.

Know before upgrading.

---

## 23. Backup Before Destructive Operations

Before:

- `DROP TABLE`;
- `DROP PARTITION`;
- large `ALTER DELETE`;
- large `ALTER UPDATE`;
- schema rewrite;
- table engine migration;
- backfill overwrite;
- report correction;
- cluster upgrade.

Run:

- backup or snapshot;
- validate backup exists;
- record restore point;
- get approval.

### 23.1 Change Checklist

```text
operation:
target:
expected rows/partitions affected:
backup id:
validation query:
rollback:
owner approval:
maintenance window:
```

---

## 24. Application-Aware Recovery

Restoring ClickHouse alone may not restore application consistency.

Need align:

- Java analytics service config;
- query family source tables;
- ingestion offsets;
- export jobs;
- report job metadata;
- dashboards cache;
- object storage export files;
- OLTP source state.

### 24.1 Ingestion Resume

After restore:

- determine last safe source offset;
- replay missing events;
- avoid duplicate unsafe inserts;
- update watermarks;
- validate.

### 24.2 Cache Invalidation

Restored data may be older than cache.

Invalidate or version caches.

### 24.3 Report State

If official report generated after backup, restore may lose it unless separately stored.

Report artifacts need independent protection.

---

## 25. Recovery Validation for Java/API

After restore/migration/upgrade, run application smoke tests:

```text
GET backlog summary
GET lifecycle trend
GET case timeline
POST export small job
generate sample report
insert test batch
query freshness
```

Validate:

- permissions;
- tenant isolation;
- query_id;
- latency;
- result correctness;
- export output;
- ingestion watermarks.

---

## 26. Runbook: Accidental DROP TABLE

### 26.1 Immediate

1. Stop writes/queries depending impact.
2. Identify exact table/drop time.
3. Preserve logs.
4. Check backups/snapshots.
5. Check if replicas also dropped.
6. Decide restore target.
7. Restore table to isolated/staging first if possible.
8. Validate.
9. Restore production.
10. Resume workloads.

### 26.2 Check Query Log

```sql
SELECT
    event_time,
    user,
    query_id,
    query
FROM system.query_log
WHERE query ILIKE '%DROP TABLE%'
ORDER BY event_time DESC;
```

### 26.3 Prevention

- restrict DROP grants;
- require migration pipeline;
- backup before destructive DDL;
- audit admin actions.

---

## 27. Runbook: Bad Mutation

### 27.1 Scenario

```sql
ALTER TABLE events DELETE WHERE tenant_id = 10;
```

but wrong tenant/range.

### 27.2 Immediate

1. Stop further mutations.
2. Identify affected partitions/rows.
3. Check if mutation completed.
4. Check backups.
5. Restore affected partition/table to staging.
6. Reinsert correct data or restore partition.
7. Rebuild rollups.
8. Validate.
9. Audit incident.

### 27.3 Prevention

- mutation approval workflow;
- dry-run SELECT count first;
- backup before large mutation;
- prefer partition reload/correction events.

---

## 28. Runbook: Region Loss

### 28.1 Immediate

1. Declare incident.
2. Determine source systems status.
3. Activate DR cluster if available.
4. Restore latest backup if needed.
5. Replay missing data from source archive.
6. Switch Java services/DNS.
7. Validate critical dashboards/reports.
8. Communicate RPO/RTO status.

### 28.2 Requirements

Need prebuilt:

- backup in another region;
- config/IaC;
- secrets;
- schema;
- source replay access;
- runbook;
- responsible people.

### 28.3 Without DR Prep

Recovery will be slow and improvisational.

---

## 29. Runbook: Failed Upgrade

### 29.1 Symptoms

- query failures;
- replication lag;
- server crashes;
- Java client errors;
- performance regression.

### 29.2 Immediate

1. Stop rollout.
2. Keep remaining nodes stable.
3. Check logs/release notes.
4. Decide rollback vs fix-forward.
5. Validate data format compatibility.
6. Restore from backup only if necessary.
7. Communicate impact.

### 29.3 Prevention

- staging test;
- canary replica;
- client compatibility test;
- backup before upgrade;
- avoid simultaneous schema changes.

---

## 30. Operational Anti-Patterns

### 30.1 Backup Without Restore Test

False confidence.

### 30.2 Replication Treated as Backup

Does not protect from logical errors.

### 30.3 No RPO/RTO

No one knows acceptable loss/downtime.

### 30.4 Backing Up Only Data, Not DDL/Users/Config

Restore incomplete.

### 30.5 Backups in Same Failure Domain

Region loss can destroy both primary and backup.

### 30.6 No Manifest for Backfill/Migration

Cannot resume/validate.

### 30.7 Upgrading Without Client Testing

Java service may break.

### 30.8 Restoring Over Production Without Staging Validation

Can worsen incident.

### 30.9 No Source Replay

RPO depends entirely on backup frequency.

### 30.10 No Report Artifact Backup

Official reports lost even if raw data exists.

---

## 31. Production Checklist

### Backup Strategy

- [ ] RPO/RTO defined per data class.
- [ ] Critical tables identified.
- [ ] Derived/rebuildable tables identified.
- [ ] Backup frequency defined.
- [ ] Retention defined.
- [ ] Backup encryption/access control configured.
- [ ] Backups stored in separate failure domain.
- [ ] DDL/config/users/grants backed up.

### Restore

- [ ] Restore procedure documented.
- [ ] Restore tested periodically.
- [ ] Validation queries defined.
- [ ] Application smoke tests defined.
- [ ] Restore owner identified.
- [ ] Restore time measured.

### DR

- [ ] DR scenarios documented.
- [ ] Region loss plan exists if required.
- [ ] Source replay available.
- [ ] Standby/warm cluster decision made.
- [ ] DNS/client failover documented.
- [ ] Communication plan exists.

### Migration

- [ ] Backfill manifest used.
- [ ] Shadow tables used for risky migrations.
- [ ] Dual-write/replay plan defined.
- [ ] Cutover criteria defined.
- [ ] Rollback plan defined.
- [ ] Validation before/after.

### Upgrade

- [ ] Release notes reviewed.
- [ ] Staging tested.
- [ ] Java client compatibility tested.
- [ ] Backup before upgrade.
- [ ] Rolling upgrade plan.
- [ ] Rollback limitations understood.

### Governance

- [ ] Backups include sensitive-data controls.
- [ ] Backup access audited.
- [ ] Deletion/privacy policy covers backups.
- [ ] Report snapshots/artifacts protected.
- [ ] Export files lifecycle managed.

---

## 32. Exercises

### Exercise 1: Replication vs Backup

You have 2 replicas. Engineer says no backup needed.

Question:

```text
Why is this wrong?
```

Expected:

```text
Replication does not protect from DROP, bad mutation, bad backfill, compromised credential, logical corruption.
```

### Exercise 2: RPO/RTO

Audit events require RPO near zero and RTO 1 hour.

What architecture helps?

Expected:

```text
durable source log/archive, frequent backups, replicas, tested restore, possible warm standby, idempotent replay.
```

### Exercise 3: Bad Backfill

Backfill double-counted June data.

What should you do?

Expected:

```text
identify manifest/batch, restore/drop/reload affected partition, rebuild rollups, validate raw vs rollup, fix backfill idempotency.
```

### Exercise 4: Upgrade

What must be tested before upgrading ClickHouse production?

Expected:

```text
representative queries, inserts, MVs, mutations, backups/restores, Java client, BI/report jobs, replication.
```

### Exercise 5: Restore Validation

After restore, what do you check?

Expected:

```text
row counts by partition, min/max time, checksums, business queries, raw vs rollup, reports, permissions, application smoke tests.
```

---

## 33. Summary

Backup and DR are not optional for production ClickHouse.

Core principles:

1. Replication is not backup.
2. RPO/RTO must be explicit per data class.
3. Backup must include data, metadata, config, access control, and external dependencies.
4. Restore testing is mandatory.
5. Derived tables may be rebuilt, but raw/audit/report data needs stronger protection.
6. Distributed restore must preserve shard semantics.
7. Object storage durability does not protect against logical deletion.
8. Replay is powerful but may be slow; measure it.
9. Migrations require shadow tables, validation, and cutover plans.
10. Upgrades require staging tests and client compatibility checks.
11. Official reports and exports need independent artifact protection.
12. Application recovery includes caches, offsets, watermarks, and report metadata.

Practical sentence:

> A backup strategy is not proven by the existence of backup files; it is proven by a timed, validated restore under realistic conditions.

---

## 34. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment:

1. ClickHouse Docs — BACKUP and RESTORE.
2. ClickHouse Docs — Backup and restore.
3. ClickHouse Docs — ReplicatedMergeTree.
4. ClickHouse Docs — Distributed table engine.
5. ClickHouse Docs — ClickHouse Keeper.
6. ClickHouse Docs — system.parts.
7. ClickHouse Docs — system.query_log.
8. ClickHouse Docs — ALTER DELETE / mutations.
9. ClickHouse Docs — Materialized views and backfilling.
10. ClickHouse Docs — S3/object storage integrations.
11. ClickHouse Docs — Cloud backup/restore if using ClickHouse Cloud.
12. ClickHouse Docs — Upgrade notes and release notes.
13. Kafka Docs — retention and replay.
14. Debezium Docs — CDC recovery and offsets.
15. Internal SRE standards — RPO/RTO, backup retention, DR drills.

---

## 35. Status Seri

Part ini adalah:

```text
Part 032 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 033 — Advanced Production Architectures and Case Studies: Multi-Tenant Analytics, Observability, Regulatory Reporting, and Cost Engineering
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Operations II: Security, Governance, Privacy, Access Control, and Compliance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-033.md">Part 033 — Advanced Production Architectures and Case Studies: Multi-Tenant Analytics, Observability, Regulatory Reporting, and Cost Engineering ➡️</a>
</div>

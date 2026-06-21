# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-028.md

# Part 028 — Operations III: Backup, Restore, Disaster Recovery, Snapshots, PITR Considerations, Tenant Restore, Backup Validation, dan DR Runbooks

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `028`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: backup dan restore ScyllaDB secara production-grade: snapshot mental model, backup artifacts, restore strategy, disaster recovery, RPO/RTO, tenant-level restore, derived table rebuild, tombstone/zombie risk, backup validation, restore drills, dan runbook DR.

---

## 0. Posisi Part Ini dalam Seri

Part 026 membahas sizing dan capacity.

Part 027 membahas repair, node lifecycle, upgrade, maintenance, dan failure modes.

Part ini membahas pertanyaan paling penting saat semua guardrail gagal:

```text
Can we recover?
```

Backup/restore bukan hanya tugas DBA.

Aplikasi Java dan data model menentukan:

- apa source of truth,
- table mana derived/rebuildable,
- bagaimana command/event log disimpan,
- bagaimana tenant restore dilakukan,
- bagaimana delete/privacy dipertahankan,
- bagaimana schema version kompatibel dengan backup,
- bagaimana derived views/search/OLAP dibangun ulang,
- bagaimana idempotency mencegah duplicate saat replay,
- bagaimana RPO/RTO realistis.

Jika aplikasi tidak dirancang untuk restore, backup file saja tidak cukup.

---

## 1. Replication Is Not Backup

Multi-replica dan multi-DC replication membantu availability.

Tetapi replication menyalin:

- bad writes,
- accidental deletes,
- corrupt application payload,
- wrong schema migration,
- privacy deletion,
- mass update bug,
- tombstones.

Jika aplikasi menjalankan bug:

```sql
DELETE FROM case_current_by_id WHERE tenant_id = ? AND case_id = ?;
```

atau backfill salah menulis jutaan rows, replication bisa menyebarkan kesalahan.

Backup melindungi dari:

- accidental deletion,
- data corruption,
- operator mistake,
- application bug,
- ransomware/security incident,
- disaster beyond replication,
- need to inspect historical state.

---

## 2. Backup vs Restore vs DR

### 2.1 Backup

Membuat salinan data/schema/metadata yang bisa dipakai untuk recovery.

### 2.2 Restore

Menggunakan backup untuk mengembalikan data ke cluster/table/environment.

### 2.3 Disaster Recovery

End-to-end kemampuan memulihkan service sesuai target RPO/RTO.

DR mencakup:

- infrastructure,
- database,
- application,
- DNS/routing,
- secrets,
- schema,
- external systems,
- search/OLAP,
- object storage,
- operational runbook.

Backup tanpa restore drill belum terbukti.

---

## 3. RPO and RTO

RPO:

```text
Recovery Point Objective
maximum acceptable data loss
```

RTO:

```text
Recovery Time Objective
maximum acceptable recovery duration
```

Example:

```text
RPO = 15 minutes
RTO = 2 hours
```

Meaning:

```text
we may lose up to 15 minutes of writes
service must recover within 2 hours
```

If business says:

```text
RPO=0, RTO=5 minutes
```

architecture cost becomes high.

Need:

- multi-region replication,
- fast failover,
- continuous backup/log,
- strong operational automation,
- tested runbooks.

---

## 4. Backup Scope

Backup must include more than base table SSTables.

Scope:

```text
schema
keyspace definitions
table definitions
UDTs
indexes/MVs definitions
data files/snapshots
application config related to schema
tenant placement
migration version
backup metadata
encryption keys or key references
object storage references
external projections if needed
```

If you backup data but lose schema or encryption keys, restore may fail.

---

## 5. Source vs Derived Data

Classify tables:

### Source of Truth

Examples:

```text
case_events_by_case_version_bucket
case_current_by_id maybe
command_log_by_id
tenant_metadata_by_id
```

Must be backed up and restored carefully.

### Derived/Rebuildable

Examples:

```text
open_cases_by_assignee_day_bucket
notifications_by_user_day maybe
search projections
aggregates
materialized views
secondary indexes
```

Can often be rebuilt from source.

Restore plan should prefer:

```text
restore source
rebuild derived
```

rather than restoring every derived artifact blindly.

---

## 6. Backup Authority Matrix

For each table:

```text
table
authority type: source/current/derived/cache
backup required?
restore directly?
rebuild source?
RPO
RTO
retention
privacy deletion impact
tenant restore support
schema version
```

Example:

| Table | Type | Restore Strategy |
|---|---|---|
| case_events_by_case_version_bucket | source audit | restore directly |
| case_current_by_id | source/current | restore or rebuild from events |
| open_cases_by_assignee_day_bucket | derived | rebuild |
| case_id_by_external_ref | derived/index-like | rebuild/validate |
| command_idempotency_by_id | operational source | restore if within retention |
| notifications_by_user_day | derived/feed | restore or regenerate depending product |
| search index | external derived | rebuild from source |

---

## 7. Snapshot Mental Model

A snapshot captures SSTable files at a point in time on a node.

Because ScyllaDB is distributed:

```text
cluster-wide consistent snapshot
```

is harder than single-node copy.

A snapshot on each node captures local replica data at its snapshot time.

Application-level consistency may require:

- quiescing writes,
- timestamped snapshots close together,
- event log replay,
- restore plus reconciliation,
- external consistency strategy.

For many OLTP systems, backups are crash-consistent and restored with application validation.

---

## 8. Backup Frequency

Backup frequency follows RPO.

If RPO 24h:

```text
daily backup may suffice
```

If RPO 15m:

```text
need more frequent incremental/continuous approach
```

Consider:

- data volume,
- write rate,
- backup duration,
- network/upload bandwidth,
- storage cost,
- restore time.

RPO promise without backup frequency and replay mechanism is fiction.

---

## 9. Backup Retention

Retention answers:

```text
how long backups are kept
```

Depends on:

- legal requirement,
- business recovery,
- privacy deletion,
- storage cost,
- ransomware protection,
- audit.

Example:

```text
daily for 30 days
weekly for 12 weeks
monthly for 12 months
```

But regulatory privacy may require deletion not live forever in backup.

Need policy.

---

## 10. Backup Encryption

Backups contain sensitive data.

Need:

- encryption at rest,
- encryption in transit,
- KMS/keys,
- key rotation,
- access control,
- audit logs,
- tenant residency.

If backup encryption key is lost:

```text
backup unrecoverable
```

If key access too broad:

```text
backup is data breach risk
```

---

## 11. Backup Location

Options:

- same region object storage,
- cross-region object storage,
- dedicated backup account/project,
- offline/immutable storage.

Trade-off:

```text
same region: residency/latency, but region disaster risk
cross-region: DR, but residency/compliance risk
immutable: ransomware protection
```

Data residency may forbid cross-region backup.

---

## 12. Schema Backup

Backup data without schema is incomplete.

Schema includes:

- keyspaces,
- tables,
- UDTs,
- table options,
- compaction,
- TTL,
- gc_grace,
- indexes/MVs definitions,
- roles/permissions maybe,
- migration version.

Restore should apply compatible schema before data.

But be careful with MV/SI restore; derived structures are often better rebuilt from base.

---

## 13. Restore Target Types

### 13.1 Same Cluster In-Place Restore

Dangerous.

Can conflict with existing live data/tombstones.

Use only with strong runbook.

### 13.2 New Cluster Restore

Safer for validation, forensic recovery, full DR.

### 13.3 Sidecar/Forensic Cluster

Restore backup to isolated cluster to inspect/copy selected records.

### 13.4 Tenant Restore Environment

Restore to temporary environment and export tenant data.

---

## 14. Full Cluster Restore

Used for:

- catastrophic loss,
- disaster recovery,
- environment clone,
- ransomware recovery.

Steps:

```text
1. provision compatible cluster
2. restore schema
3. restore data
4. run required repair/cleanup
5. validate
6. rebuild derived structures
7. restore external projections or rebuild
8. switch application traffic
```

Full restore RTO depends heavily on data volume and automation.

---

## 15. Table-Level Restore

Restore specific table.

Useful when:

- one table corrupted,
- derived table accidentally dropped,
- source table needs historical copy.

Risks:

- table relationships inconsistent,
- derived/source mismatch,
- schema version mismatch,
- tombstones and deletes not aligned,
- old data resurrection.

For derived table, often rebuild instead.

---

## 16. Row/Tenant-Level Restore Is Hard

Users often ask:

```text
restore one tenant
restore one case
restore one row
```

In shared wide-column tables, this is not simple.

Need:

- locate relevant partitions across many tables,
- restore to side cluster,
- extract tenant/entity rows,
- transform into current schema,
- replay/import idempotently,
- rebuild derived views,
- handle deletes/privacy,
- validate.

Design tenant restore explicitly if required.

---

## 17. Tenant-Level Restore Strategy

Recommended pattern:

```text
1. restore backup to isolated cluster
2. extract tenant data from source tables
3. transform to current schema if needed
4. import into production under controlled workflow
5. rebuild derived tables/search
6. validate tenant state
7. audit operation
```

Avoid raw SSTable merge into live shared cluster unless expert-run.

---

## 18. Restore and Tombstone Resurrection

Danger:

```text
restore old data from before delete
```

If tombstones are gone or not restored consistently, deleted data can reappear.

Scenarios:

- restore table snapshot older than delete,
- restore only some replicas,
- restore source but not tombstones,
- restore derived table with stale rows,
- restore backup after privacy deletion without deletion log.

Need:

- deletion/audit log,
- restore cutoff semantics,
- tombstone-aware process,
- privacy deletion replay,
- validation.

---

## 19. Privacy Deletion and Backups

If user/tenant data deleted for privacy:

```text
does backup still contain it?
```

Policies vary.

Options:

- backups expire within retention,
- cryptographic erasure via per-tenant keys,
- deletion replay after restore,
- legal documentation that backups age out,
- dedicated tenant backup deletion if feasible.

Application must record deletion events so restore can reapply them.

---

## 20. Deletion Replay After Restore

Maintain deletion log:

```sql
CREATE TABLE privacy_deletions_by_time (
    bucket_day date,
    deletion_time timestamp,
    deletion_id uuid,
    tenant_id uuid,
    subject_type text,
    subject_id text,
    command_id uuid,
    PRIMARY KEY ((bucket_day), deletion_time, deletion_id)
);
```

After restoring backup from time T:

```text
replay deletions after T
```

This prevents reintroducing deleted data.

Deletion log itself must be protected and retained according to policy.

---

## 21. Event Log as Recovery Backbone

If you have immutable event log:

```text
case_events_by_case_version_bucket
```

you can rebuild:

- current state,
- derived views,
- search projections,
- aggregates.

Event log improves recovery.

But event log must be:

- complete,
- ordered or versioned,
- schema-versioned,
- backed up,
- privacy policy aware,
- validated.

Event sourcing is not free, but powerful for restore.

---

## 22. Current State Restore vs Rebuild

`case_current_by_id` can be:

1. restored directly from backup,
2. rebuilt from event log.

Direct restore:

- faster,
- but may include stale/corrupt state.

Rebuild:

- slower,
- but validates logic,
- can use latest projection code,
- needs complete event log.

For critical systems, event-log rebuild drill is valuable.

---

## 23. Derived Table Restore

Derived table restore can be risky because derived table may be stale relative to source.

Prefer:

```text
restore source
truncate/drop derived
rebuild derived
validate
```

Examples:

- open case queues,
- search indexes,
- aggregates,
- external references,
- materialized views/secondary indexes.

If derived table is expensive to rebuild, still document correctness risk.

---

## 24. Materialized Views and Secondary Index Restore

MV/SI are derived storage structures.

Safe restore plan often:

```text
restore base table
recreate/rebuild MV/SI
```

rather than restoring MV/SI SSTables independently.

Reason:

```text
base and derived structures must be consistent
```

Always follow version-specific official guidance for MV/SI restore.

---

## 25. Restore and Schema Version

Backup taken at schema version:

```text
migration_2026_05_10_001
```

Production now at:

```text
migration_2026_06_21_010
```

Restore choices:

1. restore old schema and old app version,
2. restore old data then migrate forward,
3. transform data during import,
4. restore to forensic cluster only.

Need migration compatibility.

Do not assume old SSTables fit current schema without plan.

---

## 26. Restore and Java DTO Compatibility

If payload changed:

```text
v1 JSON
v2 JSON
v3 JSON
```

Restore may bring old payloads.

Java readers must support old versions or migration must transform.

If old enum value removed from code, restored data can crash app.

Schema evolution and restore are linked.

---

## 27. Restore and External Systems

ScyllaDB may not be only state.

External:

- Kafka offsets/events,
- object storage documents,
- search indexes,
- OLAP tables,
- caches,
- idempotency stores,
- payment systems,
- identity systems.

DR plan must define consistency across systems.

Example:

```text
Scylla restored to 10:00
Kafka projection at 10:15
search index at 09:50
object storage current
```

Need reconciliation.

---

## 28. Object Storage References

If rows store object references:

```text
evidence_object_key
document_hash
```

Backup/restore must ensure object still exists.

Need:

- object retention >= DB backup retention,
- object versioning maybe,
- region/residency alignment,
- integrity check by hash,
- deletion replay.

Restoring DB row that points to deleted object creates broken state.

---

## 29. Idempotency Store Restore

Command idempotency table may have TTL.

If restore old idempotency data:

- duplicate command prevention may behave oddly,
- old command IDs may reappear,
- command replay may be blocked,
- or duplicate side effects may happen if idempotency missing.

Define whether idempotency table is:

- restored,
- expired/reset,
- rebuilt from command log,
- ignored during DR with special mode.

---

## 30. Backup Validation

A backup not validated is hope.

Validation levels:

### 30.1 Existence

Backup files exist.

### 30.2 Integrity

Checksums match.

### 30.3 Restoreability

Can restore to test cluster.

### 30.4 Query Validation

Application can read restored data.

### 30.5 Semantic Validation

Counts/checksums/business invariants hold.

### 30.6 DR Drill

Full application runs from restored environment.

---

## 31. Restore Drill

Regularly perform:

```text
restore latest backup to isolated cluster
apply schema
start app in test mode
run validation suite
measure restore duration
record issues
```

Metrics:

- time to provision,
- time to restore data,
- time to rebuild derived,
- validation duration,
- total RTO,
- data loss estimate/RPO.

If you never restore, you do not have backup.

---

## 32. Backup Metadata

Store metadata:

```text
backup_id
cluster_id
keyspace
tables
schema_version
started_at
completed_at
node list
snapshot tags
file checksums
encryption key id
region
tool version
status
size_bytes
```

This enables audit and restore.

---

## 33. Backup Catalog

Maintain searchable catalog:

```sql
CREATE TABLE backup_catalog_by_time (
    bucket_month text,
    completed_at timestamp,
    backup_id uuid,
    cluster_id text,
    keyspace_name text,
    schema_version text,
    status text,
    size_bytes bigint,
    storage_uri text,
    PRIMARY KEY ((bucket_month), completed_at, backup_id)
);
```

Backup catalog itself must be protected.

---

## 34. Restore Runbook

A restore runbook should include:

```text
1. incident classification
2. choose restore point
3. choose restore target
4. provision cluster
5. restore schema
6. restore data
7. validate low-level data
8. run repair/cleanup if required
9. rebuild derived tables/indexes/search
10. replay deletions/commands if needed
11. run application validation
12. cut traffic
13. monitor
14. communicate
```

---

## 35. Point-in-Time Recovery Considerations

PITR means recover to specific time.

Requires more than daily snapshot.

Need:

- frequent/incremental backups,
- commitlog/archive/log-based recovery if available,
- event log replay,
- consistent timestamps,
- external system alignment,
- deletion replay.

If business requires PITR, design from day one.

---

## 36. Application-Level PITR via Event Log

If event log is source:

```text
rebuild state up to event_time/event_version <= T
```

This provides domain PITR.

But must consider:

- late events,
- correction events,
- privacy deletion,
- schema versions,
- external side effects.

For regulatory case systems, event-version-based recovery is often more meaningful than wall-clock SSTable restore.

---

## 37. DR Architecture Options

### 37.1 Backup-Only DR

Low cost, higher RTO/RPO.

### 37.2 Warm Standby

Secondary cluster exists, data replicated/backed up, app can start.

### 37.3 Active-Passive Multi-DC

Secondary receives replication, failover runbook.

### 37.4 Active-Active

Both regions serve traffic; conflict model required.

Part 025 covered multi-region trade-offs.

---

## 38. RTO Decomposition

Total RTO:

```text
detect incident
decide restore
provision infra
restore schema
restore data
rebuild derived
validate
switch traffic
warm cache
```

If data restore takes 6 hours, RTO cannot be 1 hour.

Measure every component.

---

## 39. RPO Decomposition

RPO depends on:

- backup frequency,
- replication lag,
- event log durability,
- command log availability,
- external system state,
- deletion replay,
- cutover point.

If snapshot daily but event log continuous, you may restore snapshot then replay events.

But replay must be designed/tested.

---

## 40. Full DR Drill

A full DR drill validates:

```text
can we run production-like workload from recovered environment?
```

Include:

- app startup,
- schema compatibility,
- auth/secrets,
- DB connectivity,
- tenant placement,
- search/OLAP/caches,
- object storage,
- command handling,
- read/write tests,
- failback plan.

---

## 41. Failback After Restore

After running in DR environment, returning to primary requires:

- data sync,
- write freeze or dual-write,
- compare state,
- route traffic,
- prevent split-brain,
- update placement,
- validate.

Failback can be harder than failover.

Plan it.

---

## 42. Tenant Restore Runbook

For tenant accidental deletion:

```text
1. identify tenant and restore point
2. restore backup to isolated cluster
3. extract tenant source data
4. transform to current schema
5. replay deletions/privacy constraints
6. import idempotently to production or new tenant
7. rebuild derived tables/search
8. validate tenant counts/sample/business state
9. audit
```

Need tooling before incident.

---

## 43. Case-Level Restore

For one case:

- restore backup to isolated cluster,
- extract case events/current rows,
- compare with current production,
- decide merge or new correction event,
- avoid overwriting newer legitimate data,
- audit.

Often better to create corrective domain event than raw row restore.

---

## 44. Restore as Domain Operation

For business systems, restore should often be domain-aware.

Instead of:

```text
copy old row over current row
```

Prefer:

```text
create correction command/event
```

Benefits:

- audit trail,
- validation,
- invariants,
- derived projections update normally,
- rollback possible.

Raw restore bypasses business logic.

---

## 45. Backup and Legal Hold

Legal hold may require preserving data beyond normal retention.

If data under hold:

- prevent TTL/delete,
- include in backup retention,
- mark in metadata,
- ensure restore preserves hold,
- ensure privacy deletion rules considered.

Legal hold can conflict with automatic TTL.

---

## 46. Backup Cost

Backup cost includes:

- storage bytes,
- cross-region transfer,
- API requests,
- encryption/KMS,
- restore test clusters,
- operational time,
- tooling.

Cost is justified by RPO/RTO/compliance.

Do not optimize backup cost by eliminating restoreability.

---

## 47. Backup Access Control

Backups are high-value target.

Controls:

- least privilege,
- MFA/operator approval,
- immutable storage,
- audit logs,
- separation of duties,
- no broad developer access,
- break-glass process.

Application logs should not expose backup URIs with credentials.

---

## 48. Ransomware/Destructive Actor Protection

Use:

- immutable backups,
- versioned object storage,
- separate account/project,
- delayed deletion,
- access auditing,
- restore drills.

If attacker can delete primary and backups, backup strategy failed.

---

## 49. Testing Restore with Schema Evolution

Each restore drill should include:

- older backup,
- current app version,
- migration forward,
- old enum/payload,
- dropped columns/tables,
- derived rebuild,
- index/MV rebuild.

This catches compatibility gaps.

---

## 50. Observability for Backup

Metrics:

```text
backup success/failure
backup duration
backup size
backup age
last successful backup
upload throughput
checksum failures
snapshot failures
retention deletion
storage cost
```

Alert:

```text
backup missing
backup failed
backup too old
backup size anomaly
checksum failure
retention deletion failed
```

---

## 51. Observability for Restore

Metrics:

```text
restore duration
bytes restored
tables restored
validation success
rows/count mismatch
derived rebuild progress
RTO measured
RPO measured
restore errors
```

Restore drills should produce report.

---

## 52. Communication During DR

DR incident needs communication:

- internal incident channel,
- customer status,
- expected RTO,
- data loss/RPO estimate,
- features disabled,
- tenant impact,
- restore progress,
- postmortem.

Technical restore without communication is incomplete.

---

## 53. Common Anti-Patterns

### 53.1 Replication Treated as Backup

Bad writes replicate.

### 53.2 Never Testing Restore

Backup unproven.

### 53.3 Restoring Derived Tables Blindly

Can reintroduce stale state.

### 53.4 Tenant Restore by Raw SSTable Merge

Dangerous in shared cluster.

### 53.5 Ignoring Tombstones

Zombie/resurrection risk.

### 53.6 No Deletion Replay

Privacy-deleted data reappears.

### 53.7 Backup Without Schema Version

Restore confusion.

### 53.8 Backup Without Encryption/Access Control

Security incident.

### 53.9 RTO Promise Without Measuring Restore Time

False SLA.

### 53.10 External Systems Not Included

Application state inconsistent.

---

## 54. Backup/Restore Checklist

```text
[ ] Source vs derived table matrix exists.
[ ] Backup schedule matches RPO.
[ ] Restore process matches RTO.
[ ] Schema backup included.
[ ] Backup encrypted.
[ ] Backup access controlled.
[ ] Backup catalog exists.
[ ] Restore drill performed regularly.
[ ] Derived rebuild process tested.
[ ] Privacy deletion replay designed.
[ ] Tenant restore tooling exists if promised.
[ ] Object storage references validated.
[ ] External systems included in DR.
[ ] Backup alerts configured.
[ ] Restore runbook documented.
[ ] Failback plan exists.
```

---

## 55. Mental Model Compression

Remember:

```text
Replication keeps service alive.
Backup lets you go back.
Restore proves backup is real.
DR proves the business can recover.
```

And:

```text
The safest restore restores source-of-truth first, then rebuilds derived state.
```

---

## 56. Summary

Backup and restore are application architecture concerns, not only database operations.

Key lessons:

1. Replication is not backup.
2. RPO and RTO must be explicit and measured.
3. Backup must include schema, data, metadata, and keys/references.
4. Source vs derived table classification drives restore strategy.
5. Snapshots are node/local data captures; application consistency needs design.
6. Restore to isolated cluster is often safest.
7. Tenant-level restore in shared tables is hard and needs tooling.
8. Old backups can resurrect deleted/privacy-deleted data.
9. Deletion replay is essential after restoring old backups.
10. Event logs make rebuild and PITR more feasible.
11. Derived tables, indexes, MVs, search, and aggregates are often rebuilt.
12. Schema evolution and Java DTO compatibility affect restore.
13. External systems must be included in DR.
14. Backup validation must include restore drills.
15. DR runbooks must include failover, validation, communication, and failback.
16. Backup access control and immutability protect against destructive actors.

---

## 57. Review Questions

1. Mengapa replication bukan backup?
2. Apa beda backup, restore, dan DR?
3. Apa itu RPO dan RTO?
4. Apa saja scope backup selain data?
5. Kenapa source vs derived classification penting?
6. Apa risiko snapshot dalam distributed cluster?
7. Kenapa tenant-level restore sulit?
8. Bagaimana old backup bisa menghidupkan data yang sudah dihapus?
9. Apa fungsi deletion replay?
10. Bagaimana event log membantu recovery?
11. Kapan current state sebaiknya rebuild dari event log?
12. Kenapa derived table sebaiknya rebuild?
13. Bagaimana schema evolution memengaruhi restore?
14. Apa risiko enum/payload lama saat restore?
15. Apa external system yang harus masuk DR?
16. Apa level backup validation?
17. Apa isi restore runbook?
18. Apa PITR dan apa kebutuhannya?
19. Kenapa restore lebih baik sebagai domain operation untuk kasus tertentu?
20. Apa checklist backup/restore?

---

## 58. Practical Exercise

Desain backup/restore/DR untuk regulatory case platform:

```text
Tables:
- case_events_by_case_version_bucket
- case_current_by_id
- open_cases_by_assignee_day_bucket
- command_idempotency_by_id
- privacy_deletions_by_time
- tenant_metadata_by_id
- search index external
- object storage evidence files
```

Requirement:

```text
- RPO 15 menit untuk source data
- RTO 4 jam untuk regional restore
- tenant-level restore promised for enterprise tenants
- privacy deletion must not reappear
- derived tables can be rebuilt
```

Tulis:

```text
1. source/derived matrix
2. backup schedule
3. schema backup strategy
4. backup retention
5. encryption/access control
6. deletion replay strategy
7. full restore runbook
8. tenant restore runbook
9. derived rebuild plan
10. search/object storage reconciliation
11. restore validation queries
12. DR drill plan
13. failback plan
14. metrics and alerts
15. risks and mitigations
```

---

## 59. Preview Part 029

Part berikutnya membahas:

```text
Observability:
metrics,
logs,
tracing,
dashboards,
alerts,
SLOs,
driver metrics,
ScyllaDB monitoring,
table-level metrics,
tenant-level observability,
and p99 incident diagnosis.
```

Part 028 membahas backup/restore/DR.

Part 029 akan menyatukan observability dari aplikasi Java sampai cluster ScyllaDB.

---

# End of Part 028

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Operations II: Repair, Anti-Entropy, Node Replacement, Rolling Upgrades, Maintenance, Tablets Operations, Rebalancing, dan Operational Failure Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-029.md">Part 029 — Observability: Metrics, Logs, Tracing, Dashboards, Alerts, SLOs, Driver Metrics, Table/Tenant-Level Monitoring, dan p99 Incident Diagnosis ➡️</a>
</div>

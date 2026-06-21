# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-024.md

# Part 024 — Backup, Restore, Replication, and Disaster Recovery

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus part: membuat QuestDB survivable ketika disk rusak, node hilang, operator salah hapus data, region down, atau primary tidak lagi dapat dipercaya.

---

## 1. Tujuan Part

Setelah part ini, kamu harus bisa:

1. membedakan backup, snapshot, replication, replica, restore, failover, dan disaster recovery;
2. memahami boundary durability QuestDB dari WAL sampai storage object/backup;
3. mendesain RPO/RTO yang realistis untuk workload time-series;
4. memilih strategi backup untuk OSS/self-managed dan strategi backup/replication untuk Enterprise;
5. membuat runbook restore yang dapat diuji, bukan hanya dokumen compliance;
6. menghindari failure mode berbahaya seperti backup yang tidak konsisten, restore yang tidak pernah diuji, split-brain primary, replica stale, dan retention yang menghapus data sebelum backup aman;
7. mendesain Java ingestion/query clients agar bisa bertahan saat failover, restore, atau primary migration.

Part ini bukan sekadar “cara copy folder db”. Di database time-series, backup/restore adalah bagian dari lifecycle data dan reliability architecture.

---

## 2. Problem yang Sedang Diselesaikan

QuestDB sering dipakai untuk data bernilai tinggi:

- tick market data;
- telemetry industri;
- audit/event observation;
- device measurement;
- application metrics;
- operational dashboard;
- analytics near-real-time.

Data seperti ini punya sifat khusus:

```text
high write rate
+ time partitioning
+ WAL pipeline
+ late data
+ retention
+ rollup/materialized view
+ possible object storage tiering
+ query freshness expectation
```

Maka strategi DR tidak bisa hanya bertanya:

```text
Apakah file database pernah dicopy?
```

Pertanyaan yang benar:

```text
Jika node primary hilang pada 10:03:17,
berapa data terakhir yang dijamin bisa dipulihkan,
berapa lama sistem query kembali online,
apakah ingestion dapat dilanjutkan tanpa duplicate/corruption,
dan apakah hasil query setelah restore dapat dipercaya?
```

---

## 3. Mental Model Utama

### 3.1 Backup bukan availability

Backup menjawab:

```text
Bisakah kita kembali ke state masa lalu?
```

Replication menjawab:

```text
Bisakah sistem tetap melayani atau cepat berpindah saat node utama gagal?
```

Keduanya berbeda.

Backup tanpa replication:

```text
survive data loss, but downtime may be high
```

Replication tanpa backup:

```text
survive node failure, but logical/operator error may replicate too
```

Production architecture biasanya membutuhkan keduanya.

---

### 3.2 DR adalah kontrak RPO/RTO

Dua angka utama:

```text
RPO = Recovery Point Objective
    = seberapa banyak data boleh hilang

RTO = Recovery Time Objective
    = berapa lama layanan boleh tidak tersedia
```

Contoh:

```text
RPO 5 minutes, RTO 30 minutes
```

Artinya:

- kehilangan data maksimal sekitar 5 menit dapat diterima;
- sistem harus kembali usable dalam 30 menit.

Untuk market data mungkin:

```text
RPO near-zero
RTO seconds/minutes
```

Untuk cold historical analytics mungkin:

```text
RPO 24 hours
RTO several hours
```

Jangan desain DR sebelum angka ini jelas.

---

### 3.3 Restore yang tidak pernah diuji bukan backup

Backup sukses hanya berarti proses backup menghasilkan artefak.

Restore sukses berarti:

```text
artefak backup dapat dipakai untuk membuat database baru
yang query-nya konsisten
dan aplikasi dapat menggunakan hasilnya
```

Production-grade rule:

```text
No tested restore, no backup.
```

---

## 4. Istilah Penting

| Istilah | Arti | Risiko jika disalahpahami |
|---|---|---|
| Backup | Salinan data untuk dipulihkan nanti | Mengira backup memberi failover otomatis |
| Snapshot | Capture state filesystem/disk pada waktu tertentu | Snapshot crash-inconsistent jika tidak dipersiapkan |
| Restore | Membuat DB usable dari backup/snapshot | Tidak diuji sampai incident |
| Replication | Menyalin perubahan ke node/lokasi lain | Logical corruption bisa ikut tersalin |
| Replica | Instance yang menerima perubahan dari primary | Bisa stale, bukan selalu fresh |
| Failover | Mengalihkan traffic ke node lain | Risk split-brain jika primary lama masih hidup |
| PITR | Point-in-time recovery | Butuh WAL/history yang cukup |
| DR drill | Latihan pemulihan | Sering dilewatkan karena dianggap mahal |

---

## 5. QuestDB-Specific DR Surface

QuestDB mempunyai beberapa lapisan yang relevan untuk DR:

```text
client writes
→ ingestion endpoint
→ WAL
→ WAL apply
→ native table storage
→ partitions
→ materialized views / derived tables
→ Parquet / object storage tier
→ backup manifests
→ replicas
```

Setiap lapisan punya pertanyaan DR sendiri.

### 5.1 WAL

WAL adalah log perubahan sebelum diterapkan ke storage utama. Ia relevan untuk:

- crash recovery;
- concurrent writes;
- replication;
- deduplication;
- out-of-order handling.

DR implication:

```text
Jika WAL aman tetapi apply belum selesai,
restore/recovery harus memperhitungkan perubahan yang sudah committed.
```

### 5.2 Native partitions

Time-series table disimpan per partition waktu.

DR implication:

```text
Backup/restore sering lebih natural dilakukan pada boundary partition,
tetapi committed WAL tetap harus konsisten dengan table state.
```

### 5.3 Materialized views

Materialized view adalah derived state.

DR decision:

```text
Apakah MV ikut dibackup,
atau dapat direbuild dari raw table?
```

Biasanya:

- raw data adalah source of truth;
- MV bisa direbuild;
- tetapi rebuild bisa sangat mahal.

### 5.4 Parquet/cold storage

Jika partition lama dikonversi ke Parquet/object storage, maka DR tidak hanya berbicara tentang local disk.

DR harus mencakup:

- object store bucket;
- lifecycle policy;
- permissions;
- backup metadata;
- recall/requery behavior;
- data retention alignment.

### 5.5 Replication object store

Pada Enterprise replication, primary mengirim WAL ke object storage dan replica mengambilnya dari sana.

Konsekuensi:

```text
object store menjadi durability/control-plane component,
bukan sekadar archive murah.
```

---

## 6. Backup Strategy untuk Self-Managed / OSS Mental Model

Pada OSS/self-managed, strategi dasar biasanya salah satu dari:

1. filesystem-level backup/snapshot;
2. disk snapshot cloud provider;
3. cold copy saat database dihentikan;
4. export/import subset tertentu;
5. table/partition-level archival manual.

### 6.1 Cold backup

Pattern paling sederhana:

```text
stop QuestDB
copy root/db directory
start QuestDB
```

Kelebihan:

- paling mudah dipahami;
- risiko consistency lebih rendah;
- cocok untuk environment kecil.

Kekurangan:

- downtime;
- tidak cocok untuk high-ingest production;
- RTO/RPO buruk untuk sistem kritikal.

### 6.2 Filesystem snapshot

Pattern:

```text
prepare consistent point
create filesystem/cloud disk snapshot
resume normal operation
copy snapshot to backup location
```

Risiko:

- snapshot bisa crash-consistent, bukan application-consistent;
- WAL apply sedang berjalan;
- file set bisa berubah saat backup;
- restore belum tentu diuji.

### 6.3 Export-based backup

Pattern:

```text
export selected table/time range
store as CSV/Parquet/external format
```

Cocok untuk:

- compliance archive;
- cold historical extract;
- migration;
- table-level restore;
- subset recovery.

Tidak cocok sebagai satu-satunya DR untuk high-throughput full database karena:

- restore lambat;
- schema/index/symbol config bisa hilang;
- materialized view dan metadata perlu direkonstruksi;
- RPO/RTO biasanya buruk.

---

## 7. Backup Strategy untuk Enterprise Mental Model

QuestDB Enterprise menambahkan kemampuan yang lebih cocok untuk HA/DR:

- automated backup/recovery;
- replication;
- object-store-backed WAL replication;
- point-in-time style recovery capability;
- multi-tier storage/object storage integration;
- failover-oriented topology.

Mental model:

```text
primary writes WAL
→ WAL uploaded to object store
→ replicas download/apply WAL
→ backup manifests/checkpoints define recoverable states
→ restore/failover uses object-store-backed history
```

Object store bukan optional detail; ia adalah bagian dari reliability plane.

---

## 8. Replication Mental Model

Replication berbeda dari backup karena ia mengalirkan perubahan terus-menerus.

```text
primary
  writes WAL
  uploads WAL to object store

replica
  downloads WAL
  applies WAL
  becomes queryable copy
```

### 8.1 Keuntungan

- failover lebih cepat;
- read scaling;
- geographic replica;
- DR via remote object store;
- primary tidak perlu koneksi langsung ke replica.

### 8.2 Biaya dan constraint

- butuh object store reliable;
- butuh monitoring replication lag;
- butuh primary identity yang jelas;
- butuh failover procedure yang mencegah split-brain;
- tidak semua table/metadata selalu diperlakukan sama;
- operator harus tahu mana source of truth.

### 8.3 Replication lag

Replica tidak boleh diasumsikan selalu real-time.

Harus dimonitor:

```text
primary commit time
object store upload availability
replica download/apply delay
query-visible timestamp on replica
```

Java query service harus tahu apakah replica cukup fresh untuk query tertentu.

---

## 9. RPO/RTO Design by Workload

### 9.1 Market data

Typical expectation:

```text
RPO: near-zero or seconds
RTO: seconds to minutes
```

Recommended posture:

- replication;
- idempotent ingestion;
- broker replay upstream;
- tested failover;
- raw tick retained;
- materialized OHLC rebuildable;
- strict clock/event-time validation.

### 9.2 Industrial telemetry

Typical expectation:

```text
RPO: minutes
RTO: minutes to hours depending criticality
```

Recommended posture:

- edge buffering;
- central backup;
- maybe replica for critical dashboards;
- late replay lane;
- retention by tenant/site;
- tested restore on staging.

### 9.3 Observability/custom metrics

Typical expectation:

```text
RPO: minutes to hours
RTO: minutes
```

Recommended posture:

- dashboard MV can be rebuilt;
- raw metrics maybe retained shorter;
- backup needed if metrics drive compliance/SLO audit;
- avoid treating QuestDB as sole alerting dependency unless HA exists.

### 9.4 Regulatory audit/event observation

Typical expectation:

```text
RPO: very low
RTO: business-defined
retention: strict
immutability: important
```

Recommended posture:

- append-only raw table;
- backup to immutable storage;
- retention policy reviewed legally;
- restore drills;
- audit logs for administrative operations;
- avoid destructive TTL unless policy allows it.

---

## 10. Backup Scope: What Must Be Protected

A real backup plan must cover more than raw table files.

Checklist:

```text
[ ] QuestDB root/db data
[ ] WAL files / recoverable WAL history
[ ] table metadata
[ ] symbol dictionaries
[ ] partition files
[ ] materialized views or rebuild definitions
[ ] server.conf and env config
[ ] secrets references, not plaintext secrets if avoidable
[ ] object storage paths/policies
[ ] backup manifests/checkpoints
[ ] restore scripts
[ ] schema migration history
[ ] Java client config for endpoint/failover
[ ] dashboards/query definitions
[ ] alert rules
```

Do not call it a database backup if you cannot recreate the service around the data.

---

## 11. Restore Scope: What Must Be Verified

A restore is not complete when the process exits.

Verification steps:

```text
[ ] QuestDB starts cleanly
[ ] expected tables exist
[ ] row counts match expected windows
[ ] latest timestamp per critical table is acceptable
[ ] WAL tables are healthy
[ ] no table is suspended
[ ] materialized views exist or rebuild successfully
[ ] sample dashboard queries work
[ ] Java query service connects
[ ] Java ingestion service either resumes safely or stays disabled intentionally
[ ] dedup/idempotency still works after replay
[ ] monitoring detects the restored node
[ ] backup lineage is documented
```

---

## 12. Designing Backup Frequency

Backup frequency depends on RPO, write volume, and restore cost.

### 12.1 Low criticality

```text
full backup daily
retain 7-30 days
restore drill quarterly
```

### 12.2 Medium criticality

```text
full/incremental backup hourly or several times daily
retain daily + weekly snapshots
restore drill monthly
```

### 12.3 High criticality

```text
continuous WAL/object-store replication
regular checkpoints/backups
replica in another AZ/region
restore drill monthly or per release
failover drill scheduled
```

---

## 13. Retention and Backup Interaction

This is a common production trap.

Suppose:

```text
raw table TTL = 7 days
backup retention = 3 days
backup failure unnoticed for 5 days
```

You may permanently lose data because old partitions are dropped before valid backups exist.

Invariant:

```text
retention must not delete the last recoverable copy
```

Practical rule:

```text
TTL horizon > backup validation lag + recovery window + safety margin
```

For regulated systems:

```text
operational TTL != legal retention
```

You may keep hot QuestDB raw data for 30 days but archive immutable Parquet/object-store data for years.

---

## 14. Materialized View Restore Strategy

Two options:

### Option A — Backup MV data

Pros:

- faster recovery;
- dashboard usable sooner;
- less rebuild load.

Cons:

- backup larger;
- MV freshness must be consistent;
- stale/corrupt MV can be restored too.

### Option B — Rebuild MV from raw

Pros:

- raw remains source of truth;
- simpler correctness model;
- MV bugs can be fixed during rebuild.

Cons:

- expensive;
- slow RTO;
- may overload restored instance.

Production compromise:

```text
critical short-window MVs are backed up,
large historical rollups can be rebuilt if RTO allows,
all MV DDL is version-controlled.
```

---

## 15. Java Client Behavior During Backup/Failover

### 15.1 Ingestion client

Java ingestion must handle:

- connection refusal;
- timeout;
- unknown commit outcome;
- duplicate retry;
- endpoint switch;
- circuit breaker open;
- DLQ for invalid data;
- replay after recovery.

Pseudo mental model:

```java
try {
    sender.send(event);
    sender.flush();
} catch (TimeoutException e) {
    // outcome unknown
    // retry only if event is idempotent/dedup-safe
    retryOrBuffer(event);
} catch (ConnectionException e) {
    circuitBreaker.recordFailure();
    bufferOrRouteToSecondary(event);
}
```

Rule:

```text
Failover-safe ingestion requires idempotency.
```

Without dedup/replay safety, failover can create duplicate observations.

### 15.2 Query client

Java query services must know:

- which endpoint is primary;
- which endpoint is replica;
- replica freshness;
- whether stale reads are allowed;
- timeout limits;
- fallback policy.

Example read policy:

```text
latest dashboard        -> primary or fresh replica only
historical analytics    -> replica allowed
regulatory export       -> primary or verified restored node
admin repair query      -> primary only
```

---

## 16. Failover Decision Tree

When primary is unhealthy:

```text
1. Is primary truly down, or just slow?
2. Is data disk intact?
3. Is object store reachable?
4. Is replica lag acceptable?
5. Are writers stopped or redirected?
6. Can old primary accidentally continue accepting writes?
7. Who is authorized to promote/failover?
8. How do clients discover new endpoint?
9. How will old primary be fenced before restart?
10. How is post-failover reconciliation done?
```

The most dangerous failure mode is split-brain:

```text
two primaries accept writes for the same logical database
```

Production rule:

```text
Before promoting another node, fence the old primary.
```

Fencing may mean:

- power off old VM;
- remove network access;
- detach writer DNS;
- revoke credentials;
- change load balancer routing;
- mark old primary read-only/unusable until inspected.

---

## 17. Disaster Scenarios

### 17.1 Disk full on primary

Potential impact:

- WAL cannot append;
- WAL apply fails;
- table suspended;
- backup cannot complete;
- ingestion fails or stalls.

Runbook:

```text
1. Stop non-critical ingestion.
2. Identify disk consumer: WAL, partitions, logs, backups, object-store staging.
3. Do not blindly delete WAL/table files.
4. Free safe space: logs, failed temp exports, old verified backups.
5. If retention policy allows, drop old partitions through database-supported operation.
6. Resume suspended WAL tables if needed.
7. Verify freshness and row counts.
8. Increase disk/headroom and fix alert threshold.
```

### 17.2 Operator drops wrong partition

Potential impact:

- logical data loss;
- dashboards silently wrong;
- TTL/retention breach.

Runbook:

```text
1. Stop further destructive operations.
2. Identify table and partition interval.
3. Check latest valid backup before drop.
4. Restore to separate environment.
5. Export/reinsert affected interval if safe.
6. Validate row counts/checksums/query samples.
7. Document gap and update permission/runbook.
```

### 17.3 Primary region lost

Runbook:

```text
1. Confirm region failure.
2. Fence primary if possible.
3. Promote/use replica or restore in DR region.
4. Redirect DNS/load balancer/service discovery.
5. Resume ingestion from broker/buffer.
6. Validate freshness and duplicate rate.
7. Communicate RPO/RTO actuals.
8. Later reconcile or discard old primary.
```

### 17.4 Object store misconfiguration

Symptoms:

- replication lag grows;
- backup fails;
- WAL cleanup fails;
- restore cannot find manifests;
- Data ID mismatch-like errors.

Runbook:

```text
1. Freeze destructive cleanup.
2. Verify bucket/path/credentials/region.
3. Verify database identity and object-store ownership.
4. Do not point a DB at another DB's backup path.
5. Restore only into empty, intended environment.
6. Fix config through controlled rollout.
```

---

## 18. Backup Integrity Testing

A serious DR program needs automated restore tests.

Minimum monthly job:

```text
1. Select latest backup.
2. Provision isolated restore environment.
3. Restore database.
4. Run smoke queries.
5. Compare critical table row counts/window counts.
6. Check latest timestamp per table.
7. Rebuild or validate materialized views.
8. Run application-level read tests.
9. Emit restore duration.
10. Store report.
```

Example validation queries:

```sql
-- latest timestamp per table
SELECT max(ts) FROM telemetry_raw;

-- row count for known partition window
SELECT count()
FROM telemetry_raw
WHERE ts >= dateadd('d', -1, now());

-- latest per device sanity
SELECT *
FROM telemetry_raw
LATEST ON ts PARTITION BY device_id;
```

Application-level validation matters more than raw row count alone.

---

## 19. Backup Metadata

Every backup should record:

```text
backup_id
created_at
QuestDB version
source environment
source data id / identity
schema version
server.conf checksum
included tables
oldest timestamp per critical table
latest timestamp per critical table
row count sample per critical table
object storage path
encryption status
retention expiry
restore test status
operator / automation version
```

Without metadata, backup selection during incident becomes guesswork.

---

## 20. Schema and Config Versioning

Data alone is not enough.

Version-control:

```text
DDL scripts
materialized view definitions
server.conf template
Docker image / binary version
JVM/container parameters
Kubernetes manifests / Terraform / Pulumi
alert rules
dashboard definitions
Java client config schema
retention policy definitions
backup/restore scripts
```

Restore should be reproducible from:

```text
infrastructure-as-code
+ QuestDB binary/image version
+ config
+ backup artifact
+ schema metadata
```

---

## 21. Security and Compliance Considerations

Backup/DR data is often more dangerous than live data because it may bypass normal database controls.

Protect:

- object storage IAM;
- backup encryption;
- key management;
- retention locks if required;
- restore access control;
- audit logs for restore/export;
- secrets in config;
- cross-region data residency.

Rule:

```text
A backup is a copy of production risk.
```

Do not put backups in broadly accessible buckets.

---

## 22. Architecture Patterns

### 22.1 Small OSS deployment

```text
QuestDB single node
+ daily stopped/snapshot backup
+ backup copied off-node
+ restore drill quarterly
+ upstream producer can replay 24h
```

Good for:

- dev/test;
- non-critical analytics;
- internal dashboards.

Risk:

- downtime during backup/restore;
- RPO often hours/day.

### 22.2 Production single primary with upstream replay

```text
Kafka/edge buffer
→ QuestDB primary
→ periodic backup
→ restore environment tested
```

Good when:

- Kafka retains raw events long enough;
- QuestDB is serving/query store;
- replay can rebuild lost interval.

Key invariant:

```text
upstream retention >= QuestDB recovery/replay window
```

### 22.3 Enterprise replicated HA

```text
writers → primary
primary WAL → object store
replicas ← object store WAL
queries → primary/replica based on freshness
backups/checkpoints → object store
```

Good for:

- low RPO/RTO;
- read scaling;
- DR region;
- critical dashboards.

Needs:

- replication lag monitoring;
- object store monitoring;
- failover/fencing runbook;
- client routing strategy.

### 22.4 Hot QuestDB + cold lake archive

```text
QuestDB hot native partitions
→ older partitions Parquet/object storage/archive
→ cold query or recall path
```

Good for:

- long retention;
- cost control;
- regulatory archive;
- AI/analytics reuse.

Risk:

- cold storage permissions and lifecycle become part of DR;
- queries across hot/cold may have different latency.

---

## 23. Java Architecture: DR-Aware Service Design

### 23.1 Ingestion gateway

Recommended responsibilities:

```text
validate event
assign idempotency key
write to QuestDB
handle unknown outcome
buffer or DLQ
emit ingestion metrics
support endpoint failover
```

Avoid every microservice writing directly with bespoke retry behavior.

### 23.2 Query service

Recommended responsibilities:

```text
route query to primary or replica
enforce freshness requirement
bound time range
set timeout
fallback to stale read only if allowed
expose data freshness metadata
```

Response should include freshness for dashboards/APIs:

```json
{
  "data": [...],
  "freshness": {
    "source": "questdb-replica-a",
    "maxEventTime": "2026-06-21T11:59:42Z",
    "lagSeconds": 18,
    "staleAllowed": true
  }
}
```

---

## 24. Production Checklists

### 24.1 Backup readiness

```text
[ ] RPO defined per table/workload
[ ] RTO defined per application path
[ ] backup mechanism selected
[ ] backup includes config/schema metadata
[ ] backup copied off-node/off-region if needed
[ ] backup encrypted
[ ] backup retention policy documented
[ ] backup monitored
[ ] restore test automated
[ ] restore duration measured
[ ] restore owner defined
```

### 24.2 Replication readiness

```text
[ ] replication topology documented
[ ] object store path dedicated to this database
[ ] database identity understood
[ ] primary/replica roles clear
[ ] replica lag monitored
[ ] failover runbook tested
[ ] fencing mechanism defined
[ ] client routing strategy implemented
[ ] query freshness policy implemented
[ ] backup/checkpoint interaction understood
```

### 24.3 Restore readiness

```text
[ ] restore environment can be provisioned quickly
[ ] restore script exists
[ ] restore target starts empty/clean
[ ] version compatibility checked
[ ] smoke queries defined
[ ] materialized view strategy defined
[ ] Java services can point to restored endpoint
[ ] ingestion replay procedure exists
[ ] duplicate/idempotency validation exists
[ ] post-restore signoff criteria defined
```

---

## 25. Anti-Patterns

### Anti-pattern 1 — “We have RAID, so we have backup”

RAID protects against some disk failures. It does not protect against:

- operator error;
- corrupt data;
- wrong TTL;
- region failure;
- ransomware;
- accidental table drop.

### Anti-pattern 2 — “Replica is our backup”

Replication often replicates logical mistakes.

If someone drops data and the change replicates, the replica may faithfully preserve the mistake.

### Anti-pattern 3 — “Backup succeeded, so DR is solved”

Only restore proves backup value.

### Anti-pattern 4 — “Restore directly into production during panic”

First restore into isolated environment unless the runbook explicitly permits direct restore.

### Anti-pattern 5 — “Retention before backup validation”

Dropping old partitions before backup validation can create permanent data loss.

### Anti-pattern 6 — “Failover without fencing”

Promoting a replica while the old primary can still write creates split-brain risk.

### Anti-pattern 7 — “Java retry without idempotency”

During failover, timeouts produce unknown outcomes. Blind retry can duplicate data.

---

## 26. Hands-On Lab

### Lab 1 — Define RPO/RTO matrix

Create a table:

| Data/table | Business use | RPO | RTO | Backup freq | Replica? | Rebuildable? |
|---|---|---:|---:|---|---|---|
| raw ticks | trading analytics | 5 sec | 5 min | continuous | yes | from broker maybe |
| 1m OHLC | dashboard | 1 min | 10 min | backup or rebuild | yes | yes |
| device raw | plant telemetry | 5 min | 30 min | hourly | optional | edge replay |
| audit facts | compliance | near-zero | 1 hour | immutable archive | yes | no |

### Lab 2 — Write restore smoke queries

For each critical table define:

```sql
SELECT min(ts), max(ts), count()
FROM table_name;
```

Then define query windows:

```sql
SELECT count()
FROM table_name
WHERE ts >= '2026-06-20T00:00:00.000000Z'
  AND ts <  '2026-06-21T00:00:00.000000Z';
```

### Lab 3 — Simulate Java unknown outcome

Make your ingestion code answer:

```text
If flush times out, is retry safe?
```

If answer is no, fix idempotency before claiming DR readiness.

### Lab 4 — Restore drill report template

```text
Backup ID:
Restore started:
Restore completed:
QuestDB version:
Tables restored:
Latest timestamp per critical table:
Rows validated:
Materialized views status:
Application smoke test:
RTO observed:
RPO observed:
Issues found:
Owner signoff:
```

---

## 27. Engineering Review Questions

Ask these before production signoff:

```text
1. What exact data can we lose if primary dies now?
2. How long until dashboard/query APIs are back?
3. Can producers replay the lost interval?
4. Is replay idempotent?
5. Are backups off-node and protected?
6. When was the last restore test?
7. How long did restore take?
8. Who can promote a replica?
9. How is old primary fenced?
10. How do clients discover the new endpoint?
11. Are materialized views backed up or rebuilt?
12. Does TTL ever delete data before backup validation?
13. Are object storage credentials rotated and audited?
14. What happens if object store is unavailable?
15. Do dashboards show freshness after failover?
```

---

## 28. Summary

Backup, restore, replication, and DR are not afterthoughts for QuestDB. They are part of the time-series architecture.

Core invariants:

```text
Backup is not availability.
Replication is not backup.
Restore testing is the proof.
RPO/RTO define the design.
Retention must not outrun recoverability.
Failover requires fencing.
Java retry requires idempotency.
Freshness must be observable.
```

Production-grade QuestDB systems treat data survival as a pipeline:

```text
ingestion durability
→ WAL health
→ table storage consistency
→ backup/replication history
→ restore/failover procedure
→ application-level validation
```

If any link is missing, the system may run fast but fail badly.

---

## 29. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-025.md
Security, Access, and Multi-Tenant Boundaries
```

Part 025 will focus on authentication surfaces, network exposure, tenant boundaries, RBAC/Enterprise considerations, secrets, auditability, and secure producer onboarding.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-023.md">⬅️ Failure Modes and Production Runbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-025.md">Part 025 — Security, Access, and Multi-Tenant Boundaries ➡️</a>
</div>

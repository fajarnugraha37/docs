
# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-028.md

# Part 028 — Backup, Restore, Disaster Recovery, and Data Repair

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `028`  
> Fokus: snapshot repository, snapshot lifecycle, restore, disaster recovery, RPO/RTO, rebuild from source-of-truth, consistency verification, data repair pipeline, dan DR drills  
> Target pembaca: Java software engineer / tech lead yang harus mendesain Elasticsearch sebagai derived search platform yang recoverable, auditable, dan operationally defensible.

---

## 0. Posisi Part Ini Dalam Seri

Part 026 membahas observability. Part 027 membahas failure modes dan incident response.

Part ini menjawab pertanyaan setelah incident lebih besar:

```text
Kalau index rusak, node hilang, data terhapus, migration gagal, atau cluster tidak bisa dipakai, bagaimana kita pulih?
```

Dan lebih penting:

```text
Pulih ke kondisi apa?
Dengan data set apa?
Dalam waktu berapa lama?
Dengan kehilangan data maksimum berapa?
Bagaimana membuktikan hasil restore/rebuild benar?
```

Untuk Elasticsearch, backup/restore tidak boleh dipahami sebagai “copy folder data node”. Elastic secara eksplisit menyatakan untuk self-managed deployment bahwa snapshot and restore feature harus digunakan untuk menyalin isi cluster ke repository terpisah, dan filesystem snapshot dari individual node tidak boleh dipakai sebagai mekanisme backup. Snapshot repository adalah lokasi storage off-cluster untuk menyimpan snapshot. Referensi resmi ada di bagian akhir file.

Part ini akan membangun mental model yang lebih luas:

```text
Snapshot ≠ DR strategy lengkap
Restore ≠ data correctness
Reindex ≠ repair selesai
Backup sukses ≠ restore sukses
Cluster available ≠ search behavior benar
```

---

## 1. Core Thesis

Elasticsearch recovery strategy harus didesain berdasarkan dua realitas:

### Realitas 1 — Elasticsearch Sering Bukan Source-of-Truth

Dalam banyak arsitektur backend, Elasticsearch adalah derived index:

```text
canonical database / event store / object store
→ projection/indexing pipeline
→ Elasticsearch
→ Search API
```

Artinya, recovery bisa dilakukan dengan dua jalur:

1. Restore dari snapshot Elasticsearch.
2. Rebuild dari source-of-truth.

Keduanya punya trade-off.

### Realitas 2 — Search Correctness Bukan Hanya Dokumen Ada

Restore/rebuild sukses hanya jika:

- dokumen yang seharusnya ada memang ada;
- dokumen yang seharusnya hilang memang hilang;
- field benar;
- mapping benar;
- analyzer benar;
- alias benar;
- permission benar;
- ranking signal benar;
- freshness lag terkendali;
- query behavior sesuai;
- relevance tidak rusak.

Jadi DR Elasticsearch adalah gabungan:

```text
infrastructure recovery
+ data recovery
+ search behavior recovery
+ security recovery
+ application contract recovery
```

---

## 2. Backup vs Restore vs Disaster Recovery vs Repair

### 2.1 Backup

Backup adalah salinan data/metadata yang bisa dipakai untuk pemulihan.

Di Elasticsearch, backup resmi dilakukan dengan **snapshot** ke snapshot repository.

### 2.2 Restore

Restore adalah proses mengembalikan data dari snapshot ke cluster.

Restore bisa:

- full cluster-ish restore;
- specific index restore;
- rename-on-restore;
- restore aliases;
- restore feature states;
- restore data streams;
- restore into another cluster.

### 2.3 Disaster Recovery

Disaster recovery adalah kemampuan bisnis/sistem untuk pulih dari kegagalan besar.

DR mencakup:

- backup;
- restore;
- rebuild;
- failover;
- DNS/config switch;
- secrets/access;
- application compatibility;
- RPO/RTO;
- operational runbook;
- drills.

### 2.4 Data Repair

Data repair adalah proses memperbaiki drift/inconsistency tanpa selalu restore seluruh index.

Contoh:

```text
- reindex one case
- replay missed events
- delete stale docs
- rebuild one tenant
- backfill one field
- fix permission fields
```

Data repair sering lebih berguna daripada restore penuh untuk search platform berbasis source-of-truth.

---

## 3. Recovery Objectives: RPO dan RTO

### 3.1 RPO — Recovery Point Objective

RPO menjawab:

```text
Maksimal data loss yang bisa diterima?
```

Contoh:

```text
RPO 24h:
  boleh kehilangan perubahan Elasticsearch sejak snapshot harian terakhir.

RPO 5m:
  harus bisa memulihkan sampai perubahan 5 menit terakhir.

RPO near-zero:
  perlu event replay/source-of-truth rebuild dan mungkin cross-cluster strategy.
```

Untuk Elasticsearch sebagai derived search index, RPO harus dibaca hati-hati.

Jika source-of-truth aman, “data loss Elasticsearch” mungkin bisa diperbaiki dengan rebuild/replay. Namun search availability/freshness tetap terdampak.

### 3.2 RTO — Recovery Time Objective

RTO menjawab:

```text
Berapa lama sistem boleh tidak pulih?
```

Contoh:

```text
RTO 4h:
  search boleh degraded sampai 4 jam.

RTO 15m:
  harus ada warm standby / faster restore / smaller index / partial restore.

RTO near-zero:
  perlu active-active atau cross-cluster/search failover design.
```

### 3.3 RPO/RTO Per Search Surface

Tidak semua search sama.

| Search Surface | RPO | RTO | Notes |
|---|---:|---:|---|
| Exact case lookup | low | very low | critical operational flow |
| Broad full-text search | medium | medium | degraded mode possible |
| Autocomplete | medium | low/medium | can be disabled temporarily |
| Historical archive search | high | high | restore from cold snapshot acceptable |
| Audit/legal search | low/medium | medium | correctness more important than speed |
| Export | medium/high | high | async/degraded acceptable |

Design DR berdasarkan criticality, bukan satu policy universal.

---

## 4. Snapshot Mental Model

Snapshot adalah backup Elasticsearch ke repository.

Mental model:

```text
cluster/index state at time T
→ stored incrementally in repository
→ can be restored later
```

Important properties conceptually:

- snapshots are stored outside the cluster;
- repository must be registered;
- repository can be object storage / shared file system / cloud-managed depending deployment;
- snapshots can include indices, data streams, and feature states depending options/version;
- snapshots are incremental at repository level;
- snapshots are not a replacement for source-of-truth;
- restore compatibility matters;
- repository integrity matters.

Do not think:

```text
snapshot = tar data directory
```

Think:

```text
snapshot = Elasticsearch-coordinated consistent backup artifact in a repository
```

---

## 5. Snapshot Repository

Snapshot repository is off-cluster storage location.

Examples:

```text
S3
GCS
Azure Blob
shared filesystem repository
Elastic Cloud-managed repository
```

Repository design concerns:

- durability;
- access control;
- encryption;
- region;
- latency;
- throughput;
- lifecycle/retention;
- immutability/protection;
- repository verification;
- cross-cluster access;
- cost;
- restore performance.

### 5.1 Repository Registration Example

Conceptual S3-style example:

```json
PUT /_snapshot/cases_backup_repository
{
  "type": "s3",
  "settings": {
    "bucket": "company-elasticsearch-snapshots",
    "base_path": "prod/cases-search"
  }
}
```

Actual settings depend on environment and credentials.

### 5.2 Repository Verification

After registering repository:

```http
POST /_snapshot/cases_backup_repository/_verify
```

Verification confirms nodes can access repository.

But verification once is not enough. Repository access can break later due to:

- credential rotation;
- bucket policy change;
- network/firewall change;
- cloud IAM issue;
- repository storage quota;
- object lock/lifecycle misconfiguration.

Monitor snapshot success continuously.

---

## 6. Snapshot Lifecycle Management

Snapshot Lifecycle Management, usually SLM, automates snapshot creation and retention.

A conceptual policy:

```json
PUT /_slm/policy/cases-search-daily
{
  "schedule": "0 30 1 * * ?",
  "name": "<cases-search-{now/d}>",
  "repository": "cases_backup_repository",
  "config": {
    "indices": ["cases-search-*"],
    "include_global_state": false
  },
  "retention": {
    "expire_after": "30d",
    "min_count": 7,
    "max_count": 60
  }
}
```

Policy decisions:

```text
snapshot frequency
snapshot naming
indices included
global state included or not
retention
repository
security access
monitoring/alerts
```

### 6.1 Include Global State?

`include_global_state` can restore cluster-wide metadata depending version/config.

For application search indices, many teams prefer explicit restore of indices/templates/settings rather than blindly restoring all global state into production.

Consider carefully:

- index templates;
- component templates;
- ingest pipelines;
- ILM policies;
- security feature states;
- aliases;
- system indices.

Blind full restore can overwrite things unexpectedly.

---

## 7. What Should Be Backed Up?

For Elasticsearch search platform:

```text
1. Search indices
2. Data streams if used
3. Index templates
4. Component templates
5. Ingest pipelines
6. ILM policies
7. Synonym sets/files if external
8. Search templates
9. ML/model-related assets if used
10. Security-related feature states if needed
11. Application mapping/query artifacts in Git
12. Relevance test sets
13. Indexing pipeline code/config
14. Alias topology documentation
```

Not all of these are stored in Elasticsearch snapshot the same way. Some belong in Git/config management.

A robust DR plan combines:

```text
Elasticsearch snapshots
+ infrastructure as code
+ application artifacts
+ source-of-truth backups
+ event log retention
+ runbooks
```

---

## 8. Snapshot Is Not Enough

Snapshot alone cannot answer:

```text
Were all recent source updates indexed before snapshot?
Did bulk partial failures exist?
Were permission fields stale?
Did analyzer have a bug?
Did snapshot capture wrong index alias?
Was data already corrupted before snapshot?
```

If bad data was indexed before snapshot, snapshot faithfully preserves bad data.

Therefore combine snapshot with:

- source-of-truth reconciliation;
- indexing event replay;
- data quality checks;
- restore verification;
- relevance tests;
- permission tests.

---

## 9. Restore Mental Model

Restore options:

```text
- restore all indices from snapshot;
- restore selected indices;
- restore with renamed index;
- restore into same cluster;
- restore into new cluster;
- restore data streams;
- restore aliases or not;
- restore feature states/global state;
```

A common safe pattern for application indices:

```text
restore old index under temporary name
→ verify
→ compare
→ alias cutover if needed
```

Example:

```json
POST /_snapshot/cases_backup_repository/snapshot_2026_06_22/_restore
{
  "indices": "cases-search-v028",
  "rename_pattern": "cases-search-v028",
  "rename_replacement": "cases-search-v028-restored",
  "include_aliases": false
}
```

Then:

```text
cases-search-v028-restored
→ verify
→ maybe alias swap
```

This avoids overwriting active index accidentally.

---

## 10. Restore Into Existing Cluster vs New Cluster

### 10.1 Existing Cluster Restore

Pros:

- simpler network/application config;
- faster for small restore;
- no DNS/app switch;
- useful for partial restore.

Cons:

- may affect live workload;
- name conflicts;
- resource contention;
- risk of accidental alias overwrite;
- restore traffic competes with search/indexing.

### 10.2 New Cluster Restore

Pros:

- safer isolation;
- good for DR drill;
- good for migration;
- verify before cutover;
- avoid harming live cluster.

Cons:

- more infrastructure;
- application routing/config switch needed;
- repository access needed from new cluster;
- data freshness/catch-up planning needed.

For high-risk restore, prefer new cluster or isolated environment if RTO allows.

---

## 11. Partial Restore

Partial restore is useful when:

- one index was deleted;
- one tenant index corrupted;
- one historical period missing;
- one alias migration failed;
- one data stream backing index affected.

Example plan:

```text
1. Restore affected index as temporary name.
2. Compare with source-of-truth/current index.
3. Extract required documents.
4. Reindex/repair into active index.
5. Delete temporary restored index after verification.
```

Partial restore avoids replacing healthy data.

---

## 12. Restore With Rename

Rename-on-restore is a safety tool.

Pattern:

```text
snapshot index: cases-search-v024
restore as:     cases-search-v024-restore-20260622
```

Benefits:

- no accidental overwrite;
- can inspect restored data;
- can compare documents;
- can reindex selected docs;
- can use as rollback candidate;
- can keep active search online.

Use alias cutover only after verification.

---

## 13. Restore and Aliases

Aliases are dangerous during restore if not controlled.

Risk:

```text
restore includes alias cases-search-read
→ alias now points to restored old index
→ application reads stale data
```

Guideline:

```text
For production restore, set include_aliases intentionally.
```

Often safer:

```text
include_aliases: false
```

Then manually attach aliases after validation.

---

## 14. Restore and Data Streams

Data streams add complexity:

- backing indices;
- write index;
- templates;
- ILM/data lifecycle;
- rollover;
- timestamp requirements.

If restoring data stream:

- understand whether restoring full stream or backing indices;
- verify index template exists;
- verify write index behavior;
- avoid breaking rollover;
- verify application reads expected stream/alias.

For entity search like case search, plain versioned indices + aliases may be easier to reason about. For event/log data, data streams are often appropriate.

---

## 15. Searchable Snapshots

Searchable snapshots allow mounting snapshot data as searchable indices in cold/frozen use cases. They are useful for cost-efficient historical search, but not a substitute for main operational DR unless intentionally designed.

Use cases:

```text
- historical archive search
- compliance retention search
- cold/frozen data tier
- cost reduction for rarely queried data
```

Cautions:

- latency may differ from normal hot index;
- repository availability matters;
- restore/mount behavior has operational constraints;
- not ideal for high-QPS interactive search unless tested.

---

## 16. Snapshot Frequency Design

Snapshot frequency depends on:

- RPO;
- data change rate;
- source-of-truth availability;
- event replay retention;
- index size;
- restore cost;
- repository cost;
- criticality.

Example policies:

```text
Critical case search:
  snapshot every 1h or 4h
  event replay retention 7–30 days
  rebuild capability from DB

Historical archive:
  snapshot daily
  long retention
  lower RTO

Transient autocomplete index:
  maybe rebuild from source instead of frequent snapshot
```

Do not snapshot every minute blindly. More snapshots do not automatically mean better recovery if restore is untested.

---

## 17. Snapshot Retention Design

Retention must balance:

- storage cost;
- compliance;
- rollback window;
- corruption detection window;
- restore compatibility;
- legal hold;
- data privacy deletion obligations.

Example:

```text
Hourly snapshots: keep 48 hours
Daily snapshots: keep 30 days
Weekly snapshots: keep 12 weeks
Monthly snapshots: keep 12 months if compliance requires
```

But for privacy-regulated data, retaining snapshots too long may conflict with deletion/retention rules. Coordinate with governance/legal.

---

## 18. Snapshot Monitoring

Monitor:

```text
snapshot success/failure
snapshot duration
snapshot size
snapshot start/end time
repository verification
retention cleanup success
oldest successful snapshot
latest successful snapshot age
restore drill result
```

Alert:

```text
latest successful snapshot older than RPO
snapshot failure repeated
snapshot duration exceeds window
repository verification fails
retention cleanup fails
```

A backup that fails silently is worse than no backup because it creates false confidence.

---

## 19. Restore Verification

After restore, verify:

```text
cluster health
index existence
mapping/settings
document count
aliases
data stream status
sample documents
critical queries
permission filters
facets
highlight
search latency
indexing/writes if restored as active
```

Restore verification must be explicit.

Bad:

```text
Restore command returned 200. Done.
```

Good:

```text
Restore complete
→ index green/yellow acceptable
→ doc counts expected
→ sample hashes match
→ exact ID queries pass
→ permission matrix pass
→ alias attached intentionally
→ application smoke test pass
```

---

## 20. Snapshot vs Rebuild From Source-of-Truth

| Dimension | Snapshot Restore | Rebuild From Source-of-Truth |
|---|---|---|
| Speed | Often faster for large existing index, depends repository | Depends DB/event throughput |
| Correctness | Restores captured ES state | Recomputes from canonical truth |
| Corruption handling | Restores corruption if snapshot captured it | Can fix projection bugs after code fix |
| Freshness | Snapshot time only | Can build latest state |
| Mapping change | Restore old mapping | Can build new mapping |
| Security fields | Restores old indexed state | Can recompute current permissions |
| Operational complexity | Repository/restore process | Pipeline/backfill/event replay |
| Best for | accidental delete, cluster loss, quick recovery | drift repair, schema evolution, projection bug |

For derived search systems, the best strategy is often:

```text
snapshot for fast infrastructure/data recovery
+ rebuild/replay for correctness/freshness
```

---

## 21. Disaster Recovery Architecture Patterns

### 21.1 Backup-Only DR

```text
Primary cluster
→ periodic snapshots
→ restore when disaster happens
```

Pros:

- cheapest;
- simple.

Cons:

- higher RTO;
- RPO depends snapshot frequency;
- restore untested risk;
- no warm capacity.

Use for lower criticality or historical data.

### 21.2 Warm Standby

```text
Primary cluster
→ snapshots/replay
→ standby cluster can be activated
```

Pros:

- faster RTO;
- easier restore drill;
- can pre-provision infrastructure.

Cons:

- cost;
- data catch-up complexity;
- routing/failover complexity.

### 21.3 Active-Passive With Replication/Reindex

```text
Primary source-of-truth/events
→ indexer writes primary ES
→ replicated/replayed to secondary ES
```

Pros:

- lower RTO;
- secondary can serve if primary fails.

Cons:

- consistency complexity;
- dual indexing;
- drift detection needed;
- cost.

### 21.4 Active-Active Search

```text
multiple regions/clusters serving search
```

Pros:

- high availability;
- regional latency.

Cons:

- very complex;
- conflict/freshness;
- permission consistency;
- operational cost.

Use only when business justifies complexity.

---

## 22. DR For Derived Search Index

A strong architecture:

```text
Source DB / event store is canonical
Outbox/event log retained for replay
Index projection code versioned
Elasticsearch snapshots scheduled
Index aliases versioned
Reconciliation job detects drift
Backfill job can rebuild index
Runbook can restore or rebuild
```

This gives multiple recovery routes:

```text
small drift → repair selected docs
missed event → replay events
bad field → backfill field
deleted index → restore snapshot or rebuild
bad mapping → new index + rebuild
cluster loss → restore snapshot then replay/rebuild catch-up
```

---

## 23. Data Repair Strategy

Not every issue needs full restore.

Repair types:

### 23.1 Single Document Repair

```text
caseId → fetch from source → rebuild search document → index
```

Use for:

- one stale case;
- manual correction;
- support ticket.

### 23.2 Batch Repair

```text
query source DB for affected set
→ rebuild docs
→ bulk index
```

Use for:

- cases updated in date range;
- one tenant;
- one status;
- one permission rule.

### 23.3 Event Replay Repair

```text
replay events offset N..M
```

Use for:

- consumer outage;
- missed messages;
- indexing service bug after code fix.

### 23.4 Full Rebuild

```text
create vNext
→ backfill all source data
→ catch-up
→ alias swap
```

Use for:

- mapping corruption;
- analyzer change;
- severe drift;
- rebuild from new projection.

---

## 24. Repair Pipeline Design

A repair pipeline should be:

- idempotent;
- resumable;
- observable;
- rate-limited;
- tenant-aware;
- permission-aware;
- source-of-truth based;
- bulk partial-failure aware;
- audit logged.

Input examples:

```text
case IDs
tenant ID
date range
event offset range
source DB query
DLQ entries
reconciliation mismatch report
```

Output:

```text
indexed docs
deleted stale docs
DLQ failures
repair report
metrics
audit log
```

---

## 25. Java Repair Service Sketch

A simple design:

```java
public interface SearchRepairService {
    RepairJobId repairCasesByIds(List<String> caseIds, RepairMode mode);
    RepairJobId repairTenant(String tenantId, RepairMode mode);
    RepairJobId repairUpdatedBetween(Instant from, Instant to, RepairMode mode);
    RepairJobStatus status(RepairJobId jobId);
}
```

Repair mode:

```java
public enum RepairMode {
    REINDEX_ONLY,
    DELETE_IF_SOURCE_MISSING,
    VERIFY_ONLY,
    REINDEX_AND_VERIFY
}
```

Core logic:

```java
for (String caseId : caseIds) {
    Optional<CaseEntity> source = caseRepository.findById(caseId);

    if (source.isEmpty()) {
        if (mode.deleteIfSourceMissing()) {
            elasticsearch.delete(indexAlias, caseId);
        }
        continue;
    }

    SearchDocument doc = projectionBuilder.toSearchDocument(source.get());
    elasticsearch.index(indexAlias, doc.id(), doc);
}
```

Add production necessities:

- batching;
- retries;
- DLQ;
- checkpoint;
- metrics;
- authorization;
- audit;
- dry run.

---

## 26. Reconciliation Job

Reconciliation detects drift between source-of-truth and Elasticsearch.

Approach:

```text
1. Select sample or full partition from source.
2. Build expected search projection.
3. Fetch ES document.
4. Compare version/hash/critical fields.
5. Emit mismatch report.
6. Optionally repair.
```

Metrics:

```text
reconciliation.checked
reconciliation.missing
reconciliation.extra
reconciliation.stale
reconciliation.field_mismatch
reconciliation.permission_mismatch
reconciliation.repaired
```

Reconciliation can run:

- nightly;
- per tenant;
- after migration;
- after incident;
- before DR cutover;
- after restore.

For critical regulatory data, reconciliation is a core control.

---

## 27. Delete Repair

Deletes are the easiest to miss.

Cases:

```text
source row deleted
case archived
tenant removed
document legally deleted
permission revoked
```

Repair must detect extra ES docs:

```text
document exists in Elasticsearch
but should not exist / should not be visible
```

Approaches:

1. Tombstone events.
2. Source-of-truth comparison.
3. Periodic scan by tenant/status.
4. Retention/ILM rule.
5. Legal deletion workflow.

For regulatory systems, deletion can mean:

- remove from active search;
- retain in restricted archive;
- keep audit stub;
- legal hold prevents deletion;
- anonymize fields.

Do not implement delete repair without domain policy.

---

## 28. Restore After Accidental Index Deletion

Scenario:

```text
cases-search-v028 accidentally deleted
```

Recovery options:

1. Restore from snapshot.
2. Rebuild from source-of-truth.
3. Restore old version and replay events.
4. Switch alias to previous index if still available.

Runbook:

```text
1. Stop write pipeline or route to safe buffer.
2. Confirm deleted index and aliases.
3. Identify latest valid snapshot.
4. Restore as temporary name.
5. Verify mapping/doc count/sample queries.
6. Catch up changes since snapshot using event replay/source.
7. Attach read/write aliases intentionally.
8. Resume writes.
9. Run reconciliation.
10. Post-incident hardening.
```

Important:

```text
Do not restore alias blindly.
Do not resume writes before alias target is correct.
```

---

## 29. Restore After Bad Mapping Deployment

Scenario:

```text
Dynamic mapping created thousands of bad fields
or field type changed incorrectly
```

If bad mapping index is active:

```text
1. Stop bad producer.
2. Create corrected vNext index.
3. Rebuild from source-of-truth, not bad index if possible.
4. Catch-up.
5. Alias swap.
6. Delete/quarantine bad index after safety.
```

Snapshot restore may restore the bad mapping if snapshot captured it. For mapping bugs, rebuild with fixed mapping is often better.

---

## 30. Restore After Data Corruption

Scenario:

```text
projection bug set status=CLOSED for many active cases
```

Options:

- repair affected cases from source;
- replay events after code fix;
- rebuild entire index;
- restore pre-corruption snapshot then catch up carefully.

Decision depends on:

```text
how many docs affected
can affected set be identified
is source-of-truth correct
is corruption time known
are deletes/updates after corruption replayable
```

If source-of-truth is correct, targeted repair is usually safer than restoring old snapshot and losing recent good changes.

---

## 31. Restore After Security Field Corruption

Scenario:

```text
visibilityScopes incorrectly broadened
```

Treat as security incident.

Actions:

```text
1. Disable affected search surface or enforce stricter app-side filter.
2. Identify affected time range/docs/users.
3. Fix projection code.
4. Rebuild permission fields from source authorization model.
5. Run permission matrix.
6. Run exposure audit.
7. Re-enable search.
```

Snapshot restore may not be enough if permission source changed or snapshot contains stale fields.

---

## 32. DR Drill

A DR plan is not real until tested.

Drill types:

### 32.1 Snapshot Restore Drill

```text
restore latest snapshot into isolated cluster
verify selected indices
run smoke queries
measure duration
```

### 32.2 Rebuild Drill

```text
create empty cluster/index
run backfill from source
replay events
measure RTO/RPO
```

### 32.3 Partial Restore Drill

```text
restore one index with rename
repair selected docs
verify alias unaffected
```

### 32.4 Failover Drill

```text
route app search to standby cluster
verify functionality
fail back
```

### 32.5 Security Drill

```text
restore/rebuild index
run permission matrix
verify no restricted result/facet/highlight/suggest leak
```

Document actual timings. Compare with RTO/RPO.

---

## 33. DR Drill Checklist

```text
[ ] repository accessible
[ ] latest snapshot found
[ ] restore command tested
[ ] restore duration measured
[ ] cluster health verified
[ ] index mappings/settings verified
[ ] aliases intentionally set
[ ] application can connect
[ ] critical queries pass
[ ] permission matrix pass
[ ] ingestion catch-up tested
[ ] reconciliation run
[ ] runbook updated
[ ] gaps documented
```

---

## 34. RTO Estimation

RTO for restore/rebuild includes:

```text
detect incident
decide recovery path
provision cluster if needed
register repository
restore/rebuild data
recover shards
warm caches if needed
catch up events
verify data/search/security
switch aliases/app routing
monitor
```

Do not estimate RTO as only:

```text
snapshot restore duration
```

End-to-end recovery is longer.

---

## 35. RPO Estimation

RPO depends on:

```text
snapshot frequency
snapshot success
event log retention
source-of-truth backup
indexer lag
replay capability
corruption detection time
```

If corruption is detected late, latest snapshot may contain corruption. Then RPO depends on ability to find clean snapshot or rebuild correct state from source.

---

## 36. Restore Performance Factors

Restore speed affected by:

- repository throughput;
- network bandwidth;
- index size;
- shard count;
- node count;
- disk speed;
- cluster load;
- allocation settings;
- compression;
- concurrent recoveries;
- data tier;
- object storage latency.

To improve:

- right-size shards;
- avoid huge shards;
- restore into sufficient capacity;
- isolate restore workload;
- test repository throughput;
- avoid restoring unnecessary indices;
- use partial restore when possible.

---

## 37. Snapshot Repository Security

Repository contains sensitive indexed data.

Controls:

```text
encryption at rest
encryption in transit
least privilege access
separate credentials
audit repository access
object lock/immutability if needed
retention policy
cross-account/region access review
delete protection
secret rotation
```

For regulatory data, repository access can be as sensitive as database access.

---

## 38. Snapshot and Privacy/Retention

Snapshots can retain deleted personal/sensitive data.

Questions:

```text
If user/case data must be deleted, how do snapshots comply?
How long are snapshots retained?
Can a restored snapshot reintroduce deleted data?
Are legal holds handled?
Are archive indices governed differently?
```

You need governance policy:

- snapshot retention;
- deletion/anonymization process;
- restore controls to avoid reintroducing deleted data;
- legal hold exceptions;
- audit logs.

---

## 39. Backup of Non-ES Artifacts

Many search behavior artifacts live outside Elasticsearch:

```text
Java query builder code
projection builder code
index mapping JSON in Git
synonym files
embedding model version
ranking config
feature flags
tenant permission model
backfill scripts
dashboard definitions
alert rules
runbooks
```

DR must include these.

A restored index with wrong application query code can still fail.

---

## 40. Cross-Cluster Restore / Migration

When restoring to another cluster:

Consider:

```text
version compatibility
repository access from destination
repository name requirements for searchable snapshots
security roles/users/API keys
index template compatibility
ILM/data tiers
plugins/analyzers availability
synonym files
ingest pipelines
application connectivity
network/DNS
```

Do not assume snapshot from cluster A restores cleanly to cluster B unless tested.

---

## 41. Restore Compatibility

Snapshot restore compatibility depends on Elasticsearch versions and index creation versions. Always check the official compatibility matrix for your version.

Operationally:

```text
Before major upgrade:
  verify snapshots
  test restore to target version
  document incompatible indices
```

If old indices are incompatible, you may need:

- reindex before upgrade;
- intermediate cluster;
- archive strategy;
- source-of-truth rebuild.

---

## 42. Restore Smoke Test Suite

After restore, run smoke tests:

```text
GET /_cluster/health
GET /_cat/indices
GET /_alias/cases-search-read
GET /cases-search-read/_count
GET /cases-search-read/_search exact case number
GET /cases-search-read/_search party name
GET /cases-search-read/_search with permission user A
GET /cases-search-read/_search with permission user denied
GET /cases-search-read/_search facets
GET /cases-search-read/_search highlight
```

Automate as much as possible.

---

## 43. DR For Vector / Semantic Search

If using vector search:

Backup/recovery must include:

```text
dense vector fields
embedding model version
chunking strategy
source document version
embedding generation pipeline
semantic query model
hybrid ranking config
```

Failure modes:

- restored index vectors from old model;
- query embeddings generated by new model;
- chunk IDs changed;
- source documents updated but vectors stale;
- hybrid ranking config missing.

Repair:

```text
re-embed affected docs
rebuild vector index
verify recall@K
compare hybrid search quality
```

Snapshot preserves vectors, but not necessarily the external embedding model/pipeline context.

---

## 44. DR For Synonyms and Analyzers

If synonyms are external files or managed resources:

- snapshot may not include everything;
- nodes need files/config;
- analyzer behavior after restore must match;
- synonym update can cause relevance drift.

After restore:

```text
_analyze test cases
golden query tests
synonym expansion tests
```

---

## 45. DR For Multi-Tenant Search

Tenant-aware recovery options:

```text
restore whole cluster
restore tenant-specific index
rebuild tenant
repair tenant docs
route tenant to standby
```

If using shared index with tenant field:

- partial tenant restore is harder;
- repair pipeline must filter by tenant;
- source-of-truth rebuild may be better.

If using per-tenant index:

- restore is easier per tenant;
- shard/index count may be higher;
- operational overhead bigger.

DR strategy should influence tenancy model.

---

## 46. Regulatory Case Management DR

For enforcement/case systems, define critical recovery scenarios:

```text
1. investigator cannot find active cases
2. legal/audit search unavailable
3. restricted case exposed
4. case status stale
5. evidence document not searchable
6. escalation/SLA search wrong
7. historical decision archive lost
```

For each:

```text
impact
RPO
RTO
recovery method
verification query
permission test
audit evidence
```

Example:

```text
Scenario:
Active case search index deleted.

RTO:
1 hour for exact case lookup, 4 hours for full-text relevance.

Recovery:
Restore latest snapshot into vRestore.
Replay case events since snapshot.
Run exact case smoke test.
Run permission matrix.
Alias cutover.
Run reconciliation on active cases.
```

---

## 47. Recovery Decision Framework

When incident happens, choose path:

```text
Can source-of-truth rebuild latest correct state?
|
+-- yes:
|   +-- affected set small?
|       +-- targeted repair
|   +-- affected set large?
|       +-- new index + rebuild + alias swap
|
+-- no:
    +-- valid snapshot available?
        +-- restore snapshot
        +-- replay/catch-up if possible
    +-- no:
        +-- escalate data loss scenario
```

Consider:

```text
time to restore
time to rebuild
data correctness
freshness
security
blast radius
rollback ability
```

---

## 48. Common Anti-Patterns

### 48.1 Filesystem Snapshot of Data Nodes

Do not use filesystem snapshots of individual Elasticsearch data nodes as backup mechanism. Use Elasticsearch snapshot and restore.

### 48.2 No Restore Drill

Backup without restore test is hope.

### 48.3 Restore Directly Over Active Index

Dangerous. Prefer rename-on-restore and verify.

### 48.4 Blind Alias Restore

Can route users to old/stale/wrong index.

### 48.5 Snapshot Only, No Source Rebuild

For derived index, you should also be able to rebuild from canonical source.

### 48.6 No DLQ/Reconciliation

You will not know if restored/rebuilt data is correct.

### 48.7 Ignoring Security Verification

Restore can reintroduce stale permission fields or sensitive data.

### 48.8 No RPO/RTO Per Surface

Autocomplete and legal audit search may need different recovery strategy.

### 48.9 No Documentation of External Artifacts

Synonyms, models, query code, and feature flags matter.

### 48.10 Deleting Snapshot Too Aggressively

Retention policy must balance cost, compliance, and recovery window.

---

## 49. Runbook: Restore Selected Index With Rename

```text
1. Declare incident/change window.
2. Identify snapshot:
   GET /_snapshot/{repo}/_all

3. Restore with rename and aliases disabled:
   POST /_snapshot/{repo}/{snapshot}/_restore
   {
     "indices": "cases-search-v028",
     "rename_pattern": "cases-search-v028",
     "rename_replacement": "cases-search-v028-restore-YYYYMMDD",
     "include_aliases": false
   }

4. Monitor restore:
   GET /_cat/recovery?v
   GET /_cluster/health

5. Verify:
   count, mapping, sample docs, critical queries, permission.

6. Catch up:
   replay events or repair from source.

7. Cutover if needed:
   update aliases atomically.

8. Monitor.

9. Keep old/restored indices until safety window ends.
```

---

## 50. Runbook: Rebuild From Source-of-Truth

```text
1. Create new physical index with reviewed mapping.
2. Start backfill from canonical DB/source.
3. Track progress and failures.
4. Replay/catch up events since backfill start.
5. Run reconciliation.
6. Run golden queries.
7. Run permission matrix.
8. Swap aliases.
9. Monitor freshness and error rate.
10. Decommission old index after safety window.
```

This is essentially schema migration playbook reused for DR.

---

## 51. Runbook: Repair Stale Documents

```text
1. Identify affected document IDs.
2. Fetch canonical source records.
3. Rebuild search documents using current projection code.
4. Bulk index repaired docs.
5. Delete ES docs whose source no longer exists if policy requires.
6. Verify sample.
7. Run targeted search queries.
8. Record repair report.
```

---

## 52. Runbook: Recover From Missed Events

```text
1. Identify event offset/time window.
2. Pause or checkpoint live consumer if needed.
3. Replay events to repair index.
4. Handle out-of-order by fetch-latest strategy.
5. Monitor bulk failures.
6. Verify freshness lag returns to normal.
7. Run reconciliation on affected window.
```

---

## 53. Runbook: Recover From Bad Projection Deployment

```text
1. Disable bad indexer version.
2. Deploy fixed projection code.
3. Identify affected time range/docs.
4. Choose repair strategy:
   small set → targeted repair
   large set → full rebuild
5. Reprocess from source.
6. Run field-specific verification.
7. Run query/relevance/security tests.
8. Resume normal indexing.
```

---

## 54. Operational Checklist

### Backup Readiness

```text
[ ] snapshot repository registered
[ ] repository verification monitored
[ ] SLM policy configured
[ ] snapshot success alert
[ ] retention policy approved
[ ] snapshot repository access secured
[ ] latest successful snapshot age within RPO
[ ] restore drill completed
```

### Restore Readiness

```text
[ ] restore runbook exists
[ ] rename-on-restore procedure tested
[ ] alias restore policy defined
[ ] selected index restore tested
[ ] cross-cluster restore tested if needed
[ ] smoke test automated
[ ] permission test automated
```

### Repair Readiness

```text
[ ] deterministic document IDs
[ ] source-of-truth projection builder
[ ] repair service/job exists
[ ] DLQ exists
[ ] reconciliation exists
[ ] event replay possible
[ ] backfill throttling exists
```

### DR Readiness

```text
[ ] RPO/RTO defined per search surface
[ ] critical scenarios documented
[ ] standby/rebuild/restore path chosen
[ ] infrastructure as code available
[ ] secrets/repository access available
[ ] operational roles defined
[ ] drill results documented
```

---

## 55. Example DR Scenario: Primary Cluster Lost

Situation:

```text
Primary Elasticsearch cluster unavailable permanently.
Source DB and event log are healthy.
Snapshot repository healthy.
```

Plan:

```text
1. Provision new cluster.
2. Register snapshot repository.
3. Restore latest snapshot for large baseline.
4. Replay events from snapshot timestamp to current.
5. Run reconciliation sample/full depending criticality.
6. Run permission matrix.
7. Switch application read/write aliases/config to new cluster.
8. Monitor.
```

Alternative if snapshot restore too slow or snapshot stale:

```text
create fresh indices
→ full rebuild from DB
→ replay events
→ cutover
```

Decision depends RTO.

---

## 56. Example DR Scenario: Source DB Healthy, ES Data Corrupt

Situation:

```text
Index contains wrong status for 500k cases.
Snapshot may contain same corruption.
```

Plan:

```text
1. Fix projection bug.
2. Create vNext index.
3. Rebuild affected index from source DB.
4. Replay events.
5. Verify status distribution.
6. Run lifecycle search tests.
7. Alias swap.
```

Do not restore snapshot if it may preserve corruption.

---

## 57. Example DR Scenario: Legal Deletion Reintroduced By Restore

Situation:

```text
Snapshot from 10 days ago contains data that was legally deleted 2 days ago.
Restore reintroduces it.
```

Prevention:

```text
1. Keep deletion ledger outside Elasticsearch.
2. After restore, replay deletion/anonymization events.
3. Run deletion compliance verification.
4. Only then expose restored index.
```

This is why restore must include catch-up and governance checks.

---

## 58. Exercises

### Exercise 1 — Recovery Strategy

For each incident, choose snapshot restore, rebuild, targeted repair, or event replay:

1. One case stale after update.
2. Entire index deleted.
3. Analyzer mapping wrong.
4. Permission field too broad for last 6 hours.
5. Cluster lost but source DB healthy.
6. Autocomplete index corrupted.
7. Historical archive index accidentally deleted.

Explain RPO/RTO impact.

### Exercise 2 — DR Plan For Case Search

Design DR plan for:

```text
cases-search-read
cases-search-write
source PostgreSQL
outbox Kafka topic
Elasticsearch cluster
```

Include:

- backup;
- restore;
- rebuild;
- event replay;
- alias cutover;
- verification;
- permission tests.

### Exercise 3 — Restore Verification

Create a restore smoke test suite for regulatory case search:

- exact case number;
- party search;
- status facet;
- permission denial;
- sensitive highlight;
- legal hold;
- stale deleted case;
- active escalation.

### Exercise 4 — RPO/RTO

Given:

```text
snapshot every 6h
event retention 7d
full rebuild takes 10h
snapshot restore takes 2h
event replay after restore takes 30m
```

Answer:

- best achievable RTO after cluster loss;
- best achievable RPO if event log available;
- risk if event log is unavailable;
- what drill should validate.

---

## 59. Summary

Backup, restore, disaster recovery, and repair for Elasticsearch require more than snapshots.

Key lessons:

1. Use Elasticsearch snapshot and restore, not filesystem copy of data nodes.
2. Store snapshots in verified off-cluster repository.
3. Automate snapshots with lifecycle and monitor success.
4. Define RPO/RTO per search surface.
5. Restore with rename first when possible.
6. Control alias restore intentionally.
7. Snapshot restore and source-of-truth rebuild are complementary.
8. Derived search systems should support repair/rebuild from canonical data.
9. Reconciliation is mandatory for correctness confidence.
10. DR drills are the only proof your plan works.
11. Security, permissions, deleted data, synonyms, vectors, models, and application query code are part of recovery.
12. Restore is complete only after data, search behavior, permission, freshness, and application smoke tests pass.

The most important mental model:

```text
Elasticsearch recovery is not just about bringing indices back.
It is about restoring trustworthy search behavior.
```

---

## 60. What Comes Next

Part 029 will cover:

```text
Advanced Search Features
```

Topics:

- percolator query;
- more-like-this;
- runtime fields;
- script fields;
- field collapsing;
- inner hits;
- rescore;
- rank feature;
- join field;
- geo search;
- shape search overview;
- search templates;
- async search;
- cross-cluster search;
- practical use cases and traps.

---

## References

- Elastic Docs — Snapshot and restore: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore
- Elastic Docs — Manage snapshot repositories: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/manage-snapshot-repositories
- Elastic Docs — Self-managed snapshot repositories warning about filesystem snapshots: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/self-managed
- Elastic Docs — Restore a snapshot: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/restore-snapshot
- Elastic Docs — Verify snapshot repository API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-snapshot-verify-repository
- Elastic Docs — Create or update snapshot repository API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-snapshot-create-repository
- Elastic Docs — Restore snapshot across clusters: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/ece-restore-across-clusters
- Elastic Docs — Searchable snapshots: https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/searchable-snapshots
- Elastic Docs — Searchable snapshot ILM action: https://www.elastic.co/docs/reference/elasticsearch/index-lifecycle-actions/ilm-searchable-snapshot
- Elastic Docs — Modify a data stream: https://www.elastic.co/docs/manage-data/data-store/data-streams/modify-data-stream


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Failure Modes and Incident Response</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-029.md">Part 029 — Advanced Search Features ➡️</a>
</div>

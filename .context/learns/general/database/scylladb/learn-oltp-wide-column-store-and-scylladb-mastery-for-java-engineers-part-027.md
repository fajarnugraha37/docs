# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-027.md

# Part 027 — Operations II: Repair, Anti-Entropy, Node Replacement, Rolling Upgrades, Maintenance, Tablets Operations, Rebalancing, dan Operational Failure Modes

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `027`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: operasi lifecycle cluster ScyllaDB sehari-hari: repair/anti-entropy, tombstone safety, node replacement, bootstrap, decommission, cleanup, rolling restart/upgrade, tablets/rebalancing, maintenance windows, operational failure modes, dan bagaimana aplikasi Java harus berperilaku selama operasi berlangsung.

---

## 0. Posisi Part Ini dalam Seri

Part 026 membahas:

```text
cluster sizing
capacity planning
hardware/cloud choices
disk/IO
CPU/memory
rack/AZ placement
node lifecycle baseline
```

Part ini membahas operasi yang terjadi setelah cluster berjalan:

```text
repair
node down
node replacement
scale out
scale in
rolling restart
rolling upgrade
tablet movement
cleanup
maintenance windows
failure modes
```

Untuk Java software engineer, penting memahami operasi ini karena aplikasi kamu merasakan dampaknya:

- latency naik saat repair/streaming,
- timeout naik saat node diganti,
- retry/backpressure diuji saat rolling restart,
- tombstone safety tergantung repair,
- schema/backfill harus dikoordinasikan dengan maintenance,
- tenant noisy neighbor bisa muncul saat operasi besar,
- multi-DC failover membutuhkan aplikasi menolak wrong-region writes.

Operations bukan dunia terpisah dari aplikasi.

---

## 1. Anti-Entropy Mental Model

Dalam distributed database, replica bisa berbeda sementara.

Penyebab:

```text
node down saat write
network partition
timeout
hint expired
repair belum jalan
operator restore
disk/SSTable issue
multi-DC lag
```

Anti-entropy adalah mekanisme untuk menyamakan replica.

Repair adalah operasi anti-entropy utama.

Goal:

```text
replicas for same token range eventually converge
```

Tanpa repair yang sehat:

- stale data bisa bertahan,
- tombstone tidak sampai ke semua replica,
- zombie data risk meningkat,
- consistency assumptions melemah,
- node replacement/restore risk meningkat.

---

## 2. Why Repair Exists Even with QUORUM

Engineer sering salah paham:

```text
we use LOCAL_QUORUM, so repair unnecessary
```

Salah.

Quorum membantu read/write visibility pada saat operasi.

Repair membantu long-term convergence antar replicas.

Contoh:

```text
RF=3
write CL=LOCAL_QUORUM berhasil ke A/B
C sedang down
```

Write sukses.

C tetap stale.

Jika C kembali, repair/hints/read repair mechanisms membantu menyamakan.

Untuk delete/tombstone, repair penting sebelum gc_grace_seconds.

---

## 3. Repair and Tombstones

Part 015 menjelaskan:

```text
delete writes tombstone
gc_grace_seconds retains tombstone for safety
repair should propagate tombstone before it is purged
```

Jika tombstone dipurge sebelum stale replica melihatnya:

```text
deleted data can resurrect
```

Repair schedule harus kompatibel dengan:

```text
gc_grace_seconds
delete/TTL frequency
node downtime expectations
backup/restore workflow
```

Application implication:

```text
if your table has TTL/delete-heavy workload, your schema depends on repair discipline.
```

---

## 4. Repair Cost

Repair uses:

- CPU,
- disk read,
- network,
- memory,
- streaming,
- compaction interaction,
- scheduling capacity.

Repair can affect p99.

It should be:

- scheduled,
- monitored,
- throttled if needed,
- coordinated with peak traffic,
- coordinated with backfill/export/upgrade.

Do not run every expensive operation at once.

---

## 5. Repair Scope

Repair can be scoped by:

```text
keyspace
table
token range
datacenter/local
full/incremental style depending version/tooling
```

Operational strategy may differ for:

- source-of-truth tables,
- TTL-heavy tables,
- derived rebuildable tables,
- multi-DC tables,
- huge time-series tables.

Application team should document table authority and rebuildability.

---

## 6. Repair Frequency

Repair frequency depends on:

```text
gc_grace_seconds
delete/TTL rate
failure tolerance
data criticality
cluster size
operational capacity
```

For delete-heavy tables:

```text
repair interval < gc_grace_seconds
```

If table never deletes and no TTL, zombie risk from tombstone is lower, but replica convergence still matters.

Do not set low gc_grace_seconds without repair plan.

---

## 7. Repair and Multi-DC

Multi-DC repair is more complex.

Consider:

- local vs cross-DC repair,
- WAN bandwidth,
- data residency,
- repair windows per region,
- remote DC latency,
- failover readiness.

Repair traffic can saturate WAN.

For multi-region systems, repair schedule is part of DR plan.

---

## 8. Repair and Application Behavior

During repair:

- read/write p99 may rise,
- timeouts may increase,
- compaction/disk pressure may rise,
- streaming traffic appears.

Application should:

- respect timeouts,
- use bounded retries,
- avoid retry storms,
- keep backpressure,
- pause or slow backfills,
- degrade non-critical features if needed.

Good Java client behavior from part 020 becomes critical.

---

## 9. Node Failure Types

Node can fail in different ways:

### 9.1 Clean Shutdown

Node intentionally stopped for maintenance.

### 9.2 Crash

Process/host crashes.

### 9.3 Disk Failure

Data may be unavailable/corrupted.

### 9.4 Slow Node

Node alive but slow.

Often worse than down node.

### 9.5 Network Partition

Node reachable by some, not others.

### 9.6 Flapping Node

Repeated up/down.

Can destabilize cluster and clients.

---

## 10. Slow Node Is Dangerous

A slow node can hurt p99 because:

- coordinator may wait for it at quorum,
- timeouts increase,
- retries increase,
- speculative execution may add load,
- repair/streaming may stall,
- client sees intermittent issues.

Sometimes failing fast is better than slow partial failure.

Operational monitoring must detect slow nodes, not just down nodes.

---

## 11. Hinted Handoff

When replica is down, coordinator may store hints for missed writes and replay later.

Hints help short outages.

But hints are not replacement for repair:

- hints expire,
- coordinator storing hint can fail,
- long outage exceeds hint window,
- topology changes complicate,
- not full anti-entropy.

Application should not rely solely on hinted handoff for correctness.

---

## 12. Read Repair / Reconciliation Concepts

During reads, database can detect mismatches among replicas and reconcile depending mechanisms/config/version.

But read repair only touches data that is read.

Cold data may remain inconsistent until repair.

Therefore:

```text
read repair is not substitute for scheduled repair
```

---

## 13. Node Replacement

Node replacement occurs when a node cannot be recovered or should be rebuilt.

High-level flow:

```text
1. detect node failure
2. confirm replacement needed
3. provision new node
4. join with correct identity/topology
5. stream data from replicas
6. verify node healthy
7. run required cleanup/repair per runbook
8. monitor cluster balance
```

During replacement:

- streaming load increases,
- p99 can rise,
- disk/network usage rises,
- failure tolerance reduced until complete.

Application must handle increased latency without overload.

---

## 14. Replace vs Restart Decision

If node down:

```text
restart if transient/software issue
replace if host/disk unreliable
```

Bad decisions:

- repeatedly restart failing disk node,
- replace too early during network blip,
- run multiple replacements at once,
- ignore rack/AZ placement.

Use operational runbook.

---

## 15. Bootstrap

Bootstrap is process of adding node and streaming data to it.

It happens during:

- scale-out,
- replacement,
- new cluster join.

Bootstrap consumes:

- source node disk reads,
- target disk writes,
- network,
- CPU,
- compaction.

Bootstrap should be monitored.

---

## 16. Decommission

Decommission removes node and streams data away.

Use for:

- planned scale-in,
- hardware retirement,
- topology change.

Risks:

- remaining nodes need disk space,
- streaming load,
- longer operation for large nodes,
- reduced redundancy during process.

Do not decommission during peak traffic unless necessary.

---

## 17. Cleanup

After topology changes, nodes may have data they no longer own.

Cleanup removes unneeded data.

Cleanup frees disk, but uses IO/CPU.

Coordinate cleanup with:

- compaction,
- repair,
- backfill,
- peak traffic.

---

## 18. Rolling Restart

Rolling restart restarts nodes one by one.

Use for:

- config change,
- kernel update,
- host maintenance,
- controlled recovery.

Rules:

```text
one node/rack at a time depending topology
wait for node healthy before next
monitor p99 and errors
pause heavy jobs
```

Application impact:

- some requests fail/timeout,
- driver topology updates,
- connection pools reconnect,
- retry/backpressure tested.

---

## 19. Rolling Upgrade

Upgrade changes ScyllaDB version.

High-level:

```text
read release notes
verify compatibility
test staging
backup/snapshot if required
upgrade one node/rack at a time
monitor
continue
```

Upgrade can affect:

- protocol behavior,
- features,
- compaction/tablets behavior,
- driver compatibility,
- metrics names,
- performance.

Application team should test with target version and driver.

---

## 20. Driver Compatibility During Upgrade

Java driver must be compatible with ScyllaDB version/protocol.

Before upgrade:

- check driver version,
- test prepared statements,
- test LWT,
- test paging,
- test auth/TLS,
- test metrics.

Do not upgrade database and driver blindly together in production without staged test.

---

## 21. Schema Agreement During Operations

During rolling upgrades/restarts, schema agreement and metadata refresh can be sensitive.

Avoid unnecessary DDL during:

- rolling upgrade,
- node replacement,
- cluster instability,
- repair emergency.

Schema migration windows should avoid major cluster operations.

---

## 22. Tablets Operations

Modern ScyllaDB may use tablets for data distribution.

Operational concepts:

```text
tablet movement
tablet balancing
tablet splitting/merging depending implementation/version
per-table distribution
```

Benefits:

- more granular elasticity,
- better per-table balancing,
- improved scale operations.

But:

```text
tablet movement is still data movement
```

It consumes IO/network/CPU.

Hot partition remains hot even with tablets.

---

## 23. Rebalancing

Rebalancing moves data to improve distribution after:

- adding nodes,
- removing nodes,
- load imbalance,
- tablet operations.

Rebalancing impact:

- streaming traffic,
- compaction,
- disk usage,
- latency.

Application-level throttling matters during rebalance.

---

## 24. Topology Changes and Client Metadata

When nodes added/removed, driver updates metadata.

Potential issues:

- stale metadata,
- connection churn,
- wrong contact point assumptions,
- load balancer hiding nodes,
- DNS delays.

Use topology-aware driver configuration.

Application should not pin all traffic to one node.

---

## 25. Maintenance Window Coordination

Avoid overlapping:

```text
repair
major compaction
backfill
schema migration
rolling upgrade
node replacement
large export
multi-DC failover test
```

unless deliberately planned.

Maintenance calendar should include application jobs.

Application team must expose kill switches for backfills/exports.

---

## 26. Operational Failure Mode: Disk Full

Disk full can lead to severe outage.

Causes:

- under-sizing,
- compaction backlog,
- snapshots not cleaned,
- tombstones,
- backfill,
- large tenant growth,
- logs,
- failed cleanup.

Response:

```text
stop heavy writes/backfills
identify largest tables/snapshots
scale out if possible
cleanup with ops guidance
do not randomly delete data files
```

Application:

- shed non-critical load,
- pause exports/backfills,
- reduce write amplification if possible.

---

## 27. Operational Failure Mode: Compaction Backlog

Symptoms:

- disk grows,
- SSTable count high,
- read p99 worsens,
- tombstone purge delayed,
- CPU/IO high.

Causes:

- write spike,
- backfill,
- wrong compaction strategy,
- insufficient disk/CPU,
- TTL/delete surge.

Response:

- throttle writes/backfill,
- inspect table causing backlog,
- adjust capacity/strategy with DBA,
- avoid launching more heavy jobs.

---

## 28. Operational Failure Mode: Repair Overlap

Repair plus backfill plus compaction can overload cluster.

Symptoms:

- p99 spikes,
- timeouts,
- network high,
- disk IO high.

Response:

- pause lower-priority jobs,
- reduce repair/backfill throttle,
- reschedule.

Application should expose pause controls.

---

## 29. Operational Failure Mode: Hot Shard

Symptoms:

- one shard/core much hotter,
- one partition/key dominates,
- cluster average okay,
- p99 for specific operation high.

Cause:

- hot partition,
- low-cardinality key,
- tenant/celebrity skew.

Response:

- per-key throttling,
- cache/coalescing,
- data model change,
- bucketing,
- product behavior change.

Ops cannot fully solve one hot partition by moving data.

---

## 30. Operational Failure Mode: Flapping Node

A flapping node repeatedly joins/leaves.

Impact:

- driver topology churn,
- hinted handoff/repair complexity,
- read/write timeouts,
- operator confusion.

Response:

- remove/replace unstable node,
- investigate hardware/network,
- avoid repeated automated restart loops.

Application:

- retries bounded,
- circuit breaker,
- no retry storm.

---

## 31. Operational Failure Mode: Wrong Rack/DC Config

If topology config wrong:

- replicas may be placed in wrong failure domains,
- LOCAL_QUORUM assumptions wrong,
- AZ failure can take too many replicas,
- driver local DC confusion.

Detect with topology audits.

Fix carefully; topology changes can involve data movement.

---

## 32. Operational Failure Mode: Clock Skew

Clock skew affects:

- TTL expiry,
- timestamps,
- LWT/timeouts analysis,
- last-write-wins conflict,
- audit order if misused.

Use NTP/chrony.

Application should use domain versions for ordering, not wall clock alone.

---

## 33. Operational Failure Mode: Too Many Tombstones

Symptoms:

- tombstone warnings,
- read timeout,
- compaction backlog,
- disk usage,
- p99 spikes on certain queries.

Response:

- identify table/query,
- stop bad delete/query pattern,
- rebuild table if necessary,
- adjust TTL/compaction with plan,
- validate repair/gc_grace.

Application often must fix data model.

---

## 34. Operational Failure Mode: Backfill Gone Wrong

Symptoms:

- write p99 spike,
- compaction backlog,
- disk growth,
- foreground timeouts,
- tenant complaints.

Response:

- pause job,
- reduce throttle,
- inspect rows/sec and target table,
- check payload size,
- check retry storm,
- resume gradually.

Backfill must have kill switch and dashboard.

---

## 35. Operational Failure Mode: Schema Migration Incident

Symptoms:

- prepared statement failures,
- invalid query,
- some nodes know schema, others not,
- old app crashes on new data,
- new app reads null unexpectedly.

Response:

- stop rollout,
- rollback app if safe,
- verify schema agreement,
- apply fix migration,
- restore compatibility,
- do not drop old schema prematurely.

---

## 36. Operational Failure Mode: Multi-DC WAN Issue

Symptoms:

- remote DC timeouts,
- EACH_QUORUM/global QUORUM failures,
- replication lag,
- cross-region latency spike.

Response:

- use LOCAL_* profiles if designed,
- disable cross-region heavy jobs,
- follow failover runbook,
- avoid automatic split-brain writes.

Application must route writes correctly.

---

## 37. Maintenance Readiness for Application

Before DB maintenance, application should:

```text
[ ] pause backfills/exports if requested
[ ] reduce non-critical traffic
[ ] ensure retry/backpressure healthy
[ ] monitor DB errors
[ ] keep feature flags ready
[ ] prepare rollback for schema-dependent changes
[ ] notify tenant/customer if needed
```

After maintenance:

```text
[ ] verify p99
[ ] verify error rate
[ ] resume jobs gradually
[ ] check backlog
```

---

## 38. Graceful Client Behavior During Node Restart

Driver should handle node down/up.

Application should:

- not recreate session per error,
- not panic restart all pods,
- use bounded retries,
- expose readiness carefully,
- avoid thundering herd reconnect,
- keep connection pools configured.

Bad:

```text
DB timeout -> app pod exits -> all pods restart -> connection storm
```

---

## 39. Readiness Probe Design

If readiness fails on one DB timeout, Kubernetes may restart/stop too many pods.

Better:

- readiness based on sustained inability to reach cluster,
- separate liveness from readiness,
- circuit breaker state,
- degrade feature rather than full app down if possible.

Do not create cascading failure.

---

## 40. Rolling Upgrade Application Strategy

When DB upgrade planned:

Application team should:

- test against target DB version,
- verify driver compatibility,
- freeze risky schema changes,
- pause major backfills,
- monitor operation-level metrics,
- be ready to reduce traffic,
- verify after each phase.

---

## 41. Operations and Feature Flags

Feature flags help during maintenance:

```text
disable exports
disable expensive search validation
reduce feed refresh
pause projector
switch read path
disable backfill
force stale cache for non-critical reads
```

Flags should be tested before incident.

---

## 42. Incident Triage: Is It App or DB?

Ask:

```text
Did traffic change?
Did payload size change?
Did retries spike?
Which operation/table?
Which tenants?
Which partition keys?
Did compaction/repair start?
Did node go down?
Did schema change?
Did backfill/export start?
```

Most incidents require both app and DB metrics.

---

## 43. Incident Triage Flow

```text
1. Identify user-facing symptom.
2. Map to app operation.
3. Map operation to table/query.
4. Check app metrics: QPS, latency, errors, retry, fanout.
5. Check tenant/key skew.
6. Check DB metrics: node/shard/table/compaction/repair.
7. Stop/limit non-critical load.
8. Apply targeted mitigation.
9. Record root cause.
10. Create permanent fix.
```

---

## 44. Permanent Fix vs Mitigation

Mitigation:

- pause backfill,
- throttle tenant,
- increase timeout slightly,
- disable endpoint,
- add cache,
- restart bad node.

Permanent fix:

- schema redesign,
- bucket partition,
- repair schedule,
- capacity increase,
- payload limit,
- retry policy fix,
- runbook update.

Do not confuse mitigation with fix.

---

## 45. Operational Change Review

For any major operation:

```text
what changes?
why?
blast radius?
rollback?
metrics to watch?
expected duration?
who is on call?
what jobs paused?
what app flags ready?
```

Run operational changes like production deployments.

---

## 46. Application Contract with DB Ops

Application should provide DB ops:

- table purpose,
- authority/source/derived,
- rebuild procedure,
- retention,
- TTL/delete behavior,
- expected QPS,
- backfill schedule,
- tenant skew,
- SLO,
- known hot keys,
- payload size.

Without this, DB ops sees only tables and load.

---

## 47. DB Ops Contract with Application

DB ops should provide app team:

- maintenance schedule,
- repair windows,
- upgrade windows,
- capacity status,
- disk warnings,
- compaction backlog,
- node replacement events,
- topology changes,
- recommended throttles,
- incident alerts.

Shared context prevents surprise.

---

## 48. Runbook: Node Down

Application-side actions:

```text
1. Confirm error rate impact.
2. Check retries not storming.
3. Pause backfills/exports.
4. Monitor p99 by operation.
5. If tenant-specific, apply throttle.
6. Wait for DB ops replacement/recovery.
7. Resume jobs gradually.
```

Do not blindly increase retries.

---

## 49. Runbook: Repair Window

Before:

```text
pause heavy jobs
confirm dashboards
notify if needed
```

During:

```text
watch p99/timeouts
watch compaction/disk/network
reduce traffic if needed
```

After:

```text
resume jobs
check backlog
record metrics
```

---

## 50. Runbook: Rolling Upgrade

Before:

```text
driver compatibility tested
schema migrations paused
backfills paused
feature flags ready
```

During:

```text
monitor operation p99/error
watch node state
avoid deploy storms
```

After:

```text
verify metrics
resume jobs gradually
document anomalies
```

---

## 51. Runbook: Hot Partition

Immediate:

```text
identify operation/key hash
rate limit/coalesce/cache
disable abusive endpoint if needed
```

Short-term:

```text
increase bucket count for new data
route through queue/single writer
```

Long-term:

```text
schema migration to bucketed table
backfill/rebuild
product constraints
```

---

## 52. Runbook: Disk High

Immediate:

```text
pause backfills/exports
reduce writes if possible
identify tables/snapshots
avoid manual file deletion
coordinate with DB ops
```

Long-term:

```text
scale out
fix retention
fix tombstones
drop unused tables after validation
improve compaction strategy
```

---

## 53. Runbook: Tombstone Incident

Immediate:

```text
identify query/table
stop offending query if possible
reduce range/page
disable endpoint/backfill causing deletes
```

Short-term:

```text
reconciliation/rebuild
compaction with DBA guidance
```

Long-term:

```text
data model change
TTL/compaction redesign
queue pattern removal
```

---

## 54. Runbook: Backfill Incident

Immediate:

```text
pause job
inspect retry rate
inspect rows/sec
inspect target table p99
inspect compaction/disk
```

Resume:

```text
lower throttle
canary tenant
watch metrics
```

Permanent:

```text
fix idempotency/payload/schema
update throttle defaults
```

---

## 55. Operational Baselines After Changes

After major operations:

- record before/after p99,
- disk usage,
- compaction backlog,
- repair duration,
- node balance,
- app error rate.

Baselines help future planning.

---

## 56. Common Anti-Patterns

### 56.1 No Repair Plan

Tombstone/zombie risk.

### 56.2 Repair and Backfill at Same Time

Avoidable overload.

### 56.3 Application Retries Aggressively During Maintenance

Cascading failure.

### 56.4 Automatic App Restart on DB Blip

Connection storm.

### 56.5 Drop Schema During Upgrade

Prepared statement failures.

### 56.6 Node Replacement Without App Load Shedding

p99 incident.

### 56.7 Ignore Slow Node

Tail latency persists.

### 56.8 No Kill Switch for Bulk Jobs

Cannot mitigate quickly.

### 56.9 Treat Tablets as Fix for Hot Partition

They improve distribution, not single-key heat.

### 56.10 No Shared Runbook

App and DB teams fight symptoms separately.

---

## 57. Operations II Checklist

```text
[ ] Repair schedule defined.
[ ] Repair interval compatible with gc_grace_seconds.
[ ] Repair monitored.
[ ] Node replacement runbook exists.
[ ] Rolling restart/upgrade runbooks exist.
[ ] App backfills/exports can pause.
[ ] App retry/backpressure tested during node down.
[ ] Schema migrations avoided during unstable ops.
[ ] Tablet/rebalance operations monitored.
[ ] Hot partition runbook exists.
[ ] Disk high runbook exists.
[ ] Tombstone incident runbook exists.
[ ] Multi-DC WAN incident runbook exists.
[ ] App readiness/liveness avoid cascading restart.
[ ] Shared app/DB ownership documented.
```

---

## 58. Mental Model Compression

Remember:

```text
Repair keeps replicas convergent.
Node replacement and rebalancing move data.
Rolling upgrades test client resilience.
Maintenance consumes the same resources as production traffic.
Application backpressure is part of database operations.
```

And:

```text
Operational safety is designed before the incident.
```

---

## 59. Summary

Operations are not just SRE tasks; they are part of the application/database contract.

Key lessons:

1. Repair is anti-entropy; quorum does not eliminate need for repair.
2. Repair is tied to tombstone safety and gc_grace_seconds.
3. Repair consumes resources and must be scheduled/monitored.
4. Slow nodes can be worse than down nodes for p99.
5. Hinted handoff is not repair.
6. Node replacement/bootstrap/decommission involve streaming and resource load.
7. Rolling restart/upgrade requires app retry/backpressure discipline.
8. Schema migrations should avoid unstable cluster windows.
9. Tablets/rebalancing help distribution but do not fix hot partition.
10. Disk full, compaction backlog, tombstones, hot shards, flapping nodes are common failure modes.
11. Backfills/exports must have pause/kill switch.
12. Application readiness should avoid cascading restarts.
13. Incident triage needs operation/table/tenant/key metrics.
14. Maintenance windows require app and DB coordination.
15. Runbooks must include both immediate mitigation and permanent fix.
16. Shared ownership between app and DB ops is mandatory.

---

## 60. Review Questions

1. Apa itu anti-entropy?
2. Kenapa repair tetap perlu walau memakai LOCAL_QUORUM?
3. Apa hubungan repair dengan gc_grace_seconds?
4. Kenapa repair bisa memengaruhi p99?
5. Apa bedanya hinted handoff dan repair?
6. Kenapa slow node berbahaya?
7. Apa yang terjadi saat node replacement?
8. Apa itu bootstrap?
9. Apa itu decommission?
10. Kapan cleanup diperlukan?
11. Apa risiko rolling upgrade terhadap aplikasi?
12. Bagaimana tablets membantu operasi?
13. Kenapa tablets tidak memperbaiki hot partition?
14. Apa gejala disk full incident?
15. Apa gejala compaction backlog?
16. Bagaimana aplikasi harus bereaksi saat maintenance?
17. Kenapa readiness probe bisa memperburuk outage?
18. Apa triage flow saat p99 naik?
19. Apa perbedaan mitigation dan permanent fix?
20. Apa checklist Operations II?

---

## 61. Practical Exercise

Buat operational runbook untuk regulatory case platform.

Scenario:

```text
- RF=3
- LOCAL_QUORUM writes
- TTL-heavy notifications table
- backfill open_cases_v2 sedang berjalan
- satu node di AZ-B menjadi slow
- read p99 naik 4x
- timeout rate naik
- compaction backlog naik
```

Tulis:

```text
1. immediate application actions
2. DB ops actions
3. metrics to inspect
4. how to pause backfill safely
5. retry/backpressure checks
6. tenant/noisy neighbor checks
7. tombstone/compaction checks
8. node replacement decision
9. repair consideration
10. communication plan
11. recovery validation
12. permanent fixes
```

---

## 62. Preview Part 028

Part berikutnya membahas:

```text
Operations III:
backup,
restore,
disaster recovery,
snapshots,
PITR considerations,
tenant restore,
backup validation,
restore drills,
and DR runbooks.
```

Part 027 membahas lifecycle operasi cluster.

Part 028 akan memperdalam backup/restore dan disaster recovery.

---

# End of Part 027


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Operations I: Cluster Sizing, Capacity Planning, Hardware/Cloud Choices, Disk/IO, CPU/Memory, Shard-per-Core, Rack/AZ Placement, dan Node Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-028.md">Part 028 — Operations III: Backup, Restore, Disaster Recovery, Snapshots, PITR Considerations, Tenant Restore, Backup Validation, dan DR Runbooks ➡️</a>
</div>

# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-025.md

# Part 025 — Multi-Region and Multi-DC Design: NetworkTopologyStrategy, LOCAL_QUORUM, Home Region, Active-Active, Failover, dan DR Trade-offs

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `025`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: desain ScyllaDB multi-region/multi-datacenter: replication strategy, `NetworkTopologyStrategy`, `LOCAL_QUORUM`, home region, active-active vs active-passive, data residency, latency, failover, conflict handling, disaster recovery, dan implikasi Java service.

---

## 0. Posisi Part Ini dalam Seri

Part 024 membahas multi-tenancy:

```text
tenant isolation
noisy neighbor
hot tenants
quotas
tenant placement
data residency
```

Part ini memperluas ke dimensi geografis:

```text
multi-region
multi-datacenter
data residency
regional latency
regional failover
cross-region replication
active-active conflict
DR
```

Multi-region bukan hanya:

```sql
replication = {'dc1': 3, 'dc2': 3}
```

Multi-region adalah keputusan arsitektur yang memengaruhi:

- latency,
- consistency,
- write ownership,
- conflict resolution,
- data residency,
- failover runbook,
- operational cost,
- application routing,
- Java driver local datacenter,
- tenant placement,
- backup/restore,
- incident response.

Tujuan part ini:

> Membuat kamu bisa mendesain sistem ScyllaDB multi-DC yang eksplisit tentang trade-off, bukan sekadar “replicate everywhere”.

---

## 1. Why Multi-Region?

Alasan umum:

```text
1. lower latency for users in multiple geographies
2. high availability if one region fails
3. disaster recovery
4. data residency/compliance
5. regional tenant placement
6. operational maintenance isolation
7. business continuity
```

Tetapi setiap alasan punya desain berbeda.

Low latency global read:

```text
local replicas + local reads
```

Strict global write consistency:

```text
cross-region coordination, higher latency
```

Data residency:

```text
data must not leave region
```

DR:

```text
maybe async backup/restore enough
```

Jangan mencampur semua requirement tanpa prioritas.

---

## 2. Multi-DC Vocabulary

### Region

Cloud/geographic region:

```text
ap-southeast-3
ap-southeast-1
eu-west-1
```

### Datacenter/DC

ScyllaDB/Cassandra topology unit.

Often maps to cloud region or availability-zone grouping.

### Rack

Failure domain inside DC.

Often maps to availability zone.

### RF per DC

Replication factor per datacenter.

Example:

```text
dc_jakarta: 3
dc_singapore: 3
```

### Local DC

The datacenter considered local by client/driver.

### Remote DC

Other datacenters.

---

## 3. NetworkTopologyStrategy

For multi-DC keyspaces, use `NetworkTopologyStrategy`.

Example:

```sql
CREATE KEYSPACE regulatory_platform
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc_jakarta': 3,
  'dc_singapore': 3
};
```

Meaning:

```text
store 3 replicas in Jakarta DC
store 3 replicas in Singapore DC
```

This is the standard strategy for production multi-DC Cassandra/ScyllaDB-style deployments.

Avoid `SimpleStrategy` for production multi-DC.

---

## 4. RF per DC

RF=3 per DC is common.

Example:

```text
dc_jakarta RF=3
dc_singapore RF=3
```

Benefits:

- local quorum possible,
- tolerate one replica failure per DC with LOCAL_QUORUM,
- good balance.

But RF increases:

- storage,
- write replication work,
- repair,
- streaming,
- network,
- cost.

Not every table/keyspace needs same topology.

---

## 5. Consistency Level in Multi-DC

Important CLs:

```text
LOCAL_ONE
LOCAL_QUORUM
QUORUM
EACH_QUORUM
ALL
SERIAL
LOCAL_SERIAL
```

### 5.1 LOCAL_ONE

One replica in local DC.

Low latency, stale-tolerant.

### 5.2 LOCAL_QUORUM

Quorum within local DC.

Common for authoritative local operations.

### 5.3 QUORUM

Quorum across total replicas.

If RF=3+3=6:

```text
QUORUM = 4
```

Can involve remote DC, high latency.

### 5.4 EACH_QUORUM

For writes, quorum in each DC.

High latency and lower availability.

---

## 6. Why LOCAL_QUORUM Is Common

For multi-DC user-facing OLTP:

```text
write LOCAL_QUORUM in local/home DC
read LOCAL_QUORUM in same DC
```

Benefits:

- avoids WAN round trip in success path,
- strong local quorum semantics,
- local resilience,
- remote DC outage does not necessarily block local operations,
- fits home-region model.

Caveat:

```text
LOCAL_QUORUM is not global serial consistency.
```

If two DCs write same row concurrently using LOCAL_QUORUM, conflict can happen.

---

## 7. Global QUORUM Latency Trap

With RF=3 in two DCs:

```text
total RF = 6
QUORUM = 4
```

A write/read at QUORUM may need remote replica response.

This adds:

- WAN latency,
- WAN failure coupling,
- lower availability under region/network partition,
- higher p99.

Do not use global QUORUM casually.

Use only if requirement explicitly demands cross-DC quorum and accepts latency/availability cost.

---

## 8. EACH_QUORUM Trade-Off

EACH_QUORUM write requires quorum in each DC.

Example:

```text
Jakarta needs 2/3
Singapore needs 2/3
```

Pros:

- stronger multi-DC acknowledgement.

Cons:

- write latency includes slowest DC quorum,
- remote DC outage blocks write,
- WAN partition causes failure,
- lower availability.

Often better to use:

```text
home region writes + async remote replication + DR runbook
```

unless business truly requires synchronous multi-region durability.

---

## 9. Home Region Pattern

Each tenant/entity has a home region.

Example:

```text
tenant A home_region = jakarta
tenant B home_region = singapore
```

Writes route to home region.

Reads:

- local if user in home region,
- remote read replicas if allowed,
- or route read to home for strongest freshness.

Benefits:

- avoids active-active conflicts,
- simpler correctness,
- respects data residency,
- predictable write ownership,
- LOCAL_QUORUM works well.

Tenant metadata:

```sql
CREATE TABLE tenant_placement_by_id (
    tenant_id uuid PRIMARY KEY,
    home_region text,
    home_dc text,
    data_residency_policy text,
    status text,
    placement_version bigint,
    updated_at timestamp
);
```

---

## 10. Entity Home Region

Sometimes tenant is global, but entity has home.

Example:

```text
case_id -> home_region
```

Useful if tenant operates globally but each case belongs to jurisdiction.

Need routing table:

```sql
CREATE TABLE case_home_by_id (
    tenant_id uuid,
    case_id uuid,
    home_region text,
    home_dc text,
    placement_version bigint,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Write commands must route to entity home.

---

## 11. Active-Passive

Active-passive:

```text
primary region handles writes
secondary region standby/replica
```

Reads may be:

- primary only,
- local read replica for stale reads,
- standby only during failover.

Pros:

- simpler conflict model,
- easier correctness,
- clear failover.

Cons:

- remote users may have higher write latency,
- failover process needed,
- secondary capacity may be underused.

Good for strict domains.

---

## 12. Active-Active

Active-active:

```text
multiple regions accept writes
```

Pros:

- local write latency globally,
- high regional availability,
- flexible.

Cons:

- conflict resolution required,
- global invariants hard,
- LWT/local quorum may not prevent remote conflicts,
- data residency complexity,
- debugging harder.

Use active-active only if data model supports it.

---

## 13. Active-Active Safe Patterns

Active-active is safer for:

```text
append-only independent events
per-region partitions
commutative operations
conflict-free data types
tenant/entity home ownership
local-only derived views
```

Examples:

```text
region-specific telemetry
user activity logs partitioned by region
notifications generated locally
```

Risky for:

```text
case lifecycle state
payment status
unique email reservation
inventory decrement
legal decision state
```

---

## 14. Active-Active Conflict Example

Jakarta:

```text
UPDATE case_current SET status='APPROVED', version=8
WHERE case_id=C
```

Singapore:

```text
UPDATE case_current SET status='REJECTED', version=8
WHERE case_id=C
```

Both at LOCAL_QUORUM can succeed.

Conflict resolution may be timestamp/last-write-wins at cell level.

Business invariant broken.

Mitigation:

- home region per case,
- command routing,
- LWT with correct global scope if feasible,
- append conflict events and resolve workflow,
- avoid active-active mutation for same entity.

---

## 15. Last-Write-Wins Is Not Business Resolution

Timestamp conflict resolution chooses a value.

It does not know:

```text
which legal decision is correct
which command was authorized
which transition is valid
which user clicked first
```

Do not rely on LWW for business-critical conflict resolution.

Use domain version, command ordering, home region, or explicit conflict workflow.

---

## 16. Global Uniqueness

Requirement:

```text
email unique globally
external_ref unique globally
```

Multi-region challenge.

Options:

1. home region for uniqueness key,
2. global authority service,
3. single region reservation table,
4. LWT with global SERIAL/appropriate CL if acceptable,
5. namespace uniqueness by region/tenant,
6. eventual uniqueness with conflict resolution.

For strict user-facing uniqueness, centralized/home authority is often simpler.

---

## 17. Local Uniqueness

If uniqueness scope includes tenant/home region:

```text
tenant_id + email
```

and tenant has home region, route reservation to home.

This avoids global active-active conflict.

---

## 18. Data Residency

Data residency may say:

```text
EU tenant data must remain in EU
Indonesia government data must remain in Indonesia
```

Implications:

- do not replicate keyspace to forbidden DC,
- backups stay in region,
- logs do not leak PII to other region,
- support tooling region-bound,
- analytics/search projections region-bound,
- tenant placement enforced.

Multi-DC replication can violate residency if not designed carefully.

---

## 19. Keyspace per Residency Class

If tenants have different residency:

```text
ks_global
ks_eu_only
ks_id_only
```

Different replication:

```sql
CREATE KEYSPACE ks_eu_only
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc_eu': 3
};
```

```sql
CREATE KEYSPACE ks_global
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc_us': 3,
  'dc_eu': 3
};
```

Application routes tenant to correct keyspace.

---

## 20. Tenant Placement and Residency

Tenant metadata:

```text
tenant_id
home_region
allowed_regions
keyspace
cluster
residency_policy
```

Repository cannot choose keyspace blindly.

Need placement resolver.

Cache placement carefully and invalidate on changes.

---

## 21. Java Driver Local DC

Each service deployment region should configure local DC.

Jakarta service:

```hocon
local-datacenter = "dc_jakarta"
```

Singapore service:

```hocon
local-datacenter = "dc_singapore"
```

If wrong:

- LOCAL_QUORUM applies to unintended DC,
- latency rises,
- consistency assumptions break,
- traffic crosses WAN unexpectedly.

This is one of the most critical Java config items.

---

## 22. Multi-Cluster Sessions

If app serves tenants across clusters/regions, it may need multiple sessions:

```text
session_jakarta
session_singapore
session_eu
```

Route based on tenant placement.

Do not create sessions per request.

Use session pool per cluster, initialized at startup or lazily with control.

---

## 23. Read Routing

Options:

### 23.1 Read Local

Use nearest region.

Pros:

- low latency.

Cons:

- may be stale if writes happen elsewhere.

### 23.2 Read Home

Route to home region.

Pros:

- freshest/authoritative.

Cons:

- higher latency for remote users.

### 23.3 Read Local Then Validate Home

For stale-tolerant UI.

### 23.4 Read Local Derived, Command Home

Common:

```text
UI list local/stale
command validates at home authoritative state
```

---

## 24. Write Routing

For correctness, writes should have clear owner.

Options:

```text
tenant home region
entity home region
command type home
global authority
active-active conflict workflow
```

Do not let any region write any entity unless conflict semantics are designed.

---

## 25. Failover Types

### 25.1 Read Failover

If local read fails, read from remote.

Can return stale data or higher latency.

### 25.2 Write Failover

If home region down, allow writes in another region.

Harder, because later reconciliation needed.

### 25.3 Full Region Failover

Traffic moves to secondary region.

Requires:

- capacity,
- routing,
- data freshness,
- DNS/load balancer changes,
- app config,
- runbook.

---

## 26. Automatic Failover Danger

Automatic write failover can create split-brain.

Scenario:

```text
network partition
Jakarta thinks Singapore down
Singapore thinks Jakarta down
both accept writes
```

After healing, conflicts.

For strict domains, prefer manual/operator-controlled failover with fencing.

---

## 27. Fencing

Fencing prevents two regions from acting as primary simultaneously.

Mechanisms:

- external control plane,
- lease with fencing token,
- DNS/traffic control,
- write gate flag,
- operator approval,
- epoch number.

Example:

```text
case_home_epoch = 42
only region with active epoch can write
```

All writes include/check epoch.

Fencing is essential for safe failover of strict state.

---

## 28. RPO and RTO

DR terms:

```text
RPO = Recovery Point Objective
how much data loss acceptable

RTO = Recovery Time Objective
how long until service restored
```

Design depends on target.

If RPO near zero:

```text
need synchronous/multi-DC replication or strong workflow
```

If RTO low:

```text
warm standby capacity and automated runbook
```

If both strict, cost/complexity high.

---

## 29. Multi-DC Replication Is Not Backup

Replication copies bad writes/deletes too.

If app deletes/corrupts data:

```text
replication spreads corruption
```

Need:

- backups,
- snapshots,
- point-in-time strategy if available,
- audit/event log,
- restore testing.

Replication improves availability; backup improves recoverability.

---

## 30. Backup in Multi-Region

Consider:

- region-local backup,
- cross-region backup,
- encryption,
- residency,
- restore target,
- bandwidth,
- retention,
- legal hold.

If residency forbids cross-region backup, DR options change.

---

## 31. Repair in Multi-DC

Repair keeps replicas consistent.

Multi-DC repair can consume network and IO.

Operational plan must include:

- per-DC repair scheduling,
- bandwidth control,
- avoiding peak traffic,
- tombstone gc grace compatibility,
- monitoring.

Application teams should know repair affects performance windows.

---

## 32. Multi-DC Network Cost

Cross-region replication costs:

- bandwidth,
- latency,
- egress charges,
- operational complexity.

Large payload duplication hurts more in multi-DC.

Store large documents in region-appropriate object storage and keep references in ScyllaDB.

---

## 33. Multi-DC Schema Migration

DDL must be applied cluster-wide and reach schema agreement.

If multiple clusters:

```text
apply migration per cluster
verify each
coordinate app rollout per region
```

Risks:

- region A app expects schema not present in region B,
- mixed version during failover,
- keyspace replication differs.

Migration runbook must be region-aware.

---

## 34. Multi-DC Backfill

Backfill in multi-DC can be done:

1. write in one DC and rely on replication,
2. write independently in each DC,
3. backfill per regional cluster,
4. restore/bulk load per DC.

Usually prefer:

```text
write once to authority/home and let replication handle
```

unless data residency/topology requires otherwise.

Throttle to avoid WAN saturation.

---

## 35. Multi-DC Derived Views

Derived view can be:

```text
global replicated view
regional local view
home-region authoritative view
```

Example:

```text
open_cases_by_assignee in tenant home region
```

For remote UI, maybe replicate local read view.

But if view is derived asynchronously, remote staleness must be explicit.

---

## 36. Search/OLAP Multi-Region

Search/OLAP projections must follow same residency/failover rules.

Do not replicate ScyllaDB correctly but leak data into global search cluster.

Design:

- regional search index,
- tenant-scoped index,
- cross-region projection allowed only by policy,
- delete/privacy propagation.

---

## 37. Conflict Detection

If active-active possible, include fields:

```text
source_region
command_id
source_version
updated_at
writer_id
home_epoch
```

These help detect conflict.

But detection is not resolution.

Resolution policy must be domain-specific.

---

## 38. Conflict Resolution Strategies

Options:

### 38.1 Reject Remote Writes

Route all writes to home.

### 38.2 Last-Write-Wins

Only for non-critical/commutative-ish fields.

### 38.3 Merge

For sets/tags if commutative.

### 38.4 Version Vector / Causal Metadata

Complex; use only if needed.

### 38.5 Manual Workflow

For legal/business conflicts.

### 38.6 Event Sourcing

Record all facts, resolve current state through workflow.

---

## 39. Region-Scoped IDs

Use IDs that avoid regional collision.

UUID random usually okay.

But if using sequence numbers:

```text
region_id + sequence
```

or home-region allocator.

Do not rely on local auto-increment.

---

## 40. Clock Skew

Multi-region clock skew affects:

- timestamps,
- TTL coordinator time,
- LWW conflict,
- audit ordering,
- timeout analysis.

Use NTP/chrony.

For domain ordering, use:

```text
version/event sequence
```

not wall clock alone.

---

## 41. Latency Budget

Cross-region latency can dominate.

Example:

```text
Jakarta <-> Frankfurt 180ms RTT
```

If write path requires remote quorum:

```text
p99 likely high
```

Design user-facing OLTP around local quorum/home region.

Use async replication for non-critical remote propagation.

---

## 42. Regional Cache

Regional cache can reduce read latency.

But cache staleness must align with read semantics.

Safe for:

- derived views,
- reference data,
- stale-tolerant feeds.

Avoid for:

- command decisions,
- strict authorization,
- uniqueness reservation.

Cache key includes tenant/region.

---

## 43. Regional Outage Modes

Outage types:

```text
single node down
single AZ/rack down
entire DC down
WAN partition
partial packet loss
DNS/routing failure
cloud control plane issue
application-only regional bug
```

Failover plan differs for each.

Do not treat all as “region down”.

---

## 44. Split-Brain

Split-brain:

```text
two regions both believe they are primary
```

Danger for strict state.

Prevent with:

- fencing,
- manual failover,
- single writer,
- external consensus/control plane,
- epoch checks.

ScyllaDB replication alone does not define business primary.

---

## 45. Failback

After failover to secondary, returning to primary is failback.

Hard part:

- writes happened in secondary,
- primary may be stale,
- conflicts possible,
- placement/home region changes,
- clients caches stale,
- projections/search need sync.

Failback needs runbook like migration.

---

## 46. Regional Capacity Planning

If secondary must take over primary traffic, it needs capacity.

Options:

- active-active with both regions sized for full failover,
- warm standby with partial capacity and degraded mode,
- cold standby with longer RTO.

Capacity strategy affects cost.

Do not claim low RTO if standby lacks capacity.

---

## 47. Degraded Mode

During regional failure, degrade:

- disable exports/backfills,
- reduce page size,
- serve stale reads,
- pause non-critical projections,
- block non-home writes,
- lower tenant quotas,
- disable expensive search/reporting.

Plan degraded mode by feature.

---

## 48. Data Residency vs Failover

If tenant data cannot leave region, failover to another region may be illegal.

Options:

- failover only within allowed region,
- backup within same jurisdiction,
- no cross-region DR for strict tenant,
- dedicated regional cluster,
- customer-approved DR region.

Compliance constraints override convenience.

---

## 49. Observability Multi-Region

Metrics dimension:

```text
region
dc
local_dc
remote_dc
tenant
operation
CL
profile
```

Need dashboards:

- per-region latency,
- cross-region traffic,
- replication/repair health,
- regional error rate,
- failover status,
- local vs remote reads,
- placement mismatches,
- write attempts outside home.

---

## 50. Alerting Multi-Region

Alerts:

```text
remote DC unreachable
local quorum failures
cross-region latency spike
unexpected global QUORUM usage
writes to non-home region
replication lag/projection lag
repair backlog
region-specific timeout spike
failover flag inconsistent
placement cache stale
```

---

## 51. Java Guardrails

Application should prevent unsafe operations.

Examples:

```java
if (!placement.homeDc().equals(localDc) && operation.requiresHomeWrite()) {
    throw new WrongRegionForWriteException(...);
}
```

or route:

```java
return homeRegionClient.execute(command);
```

Do not let command writes accidentally execute in any region.

---

## 52. Local vs Home Execution Profiles

Profiles:

```text
local-derived-read:
  CL LOCAL_ONE
  timeout short

home-authoritative-read:
  CL LOCAL_QUORUM
  routed to home

home-source-write:
  CL LOCAL_QUORUM
  routed to home

emergency-failover-write:
  CL LOCAL_QUORUM
  allowed only if failover epoch active
```

Execution profile alone is not enough; routing must match semantics.

---

## 53. Multi-Region Testing

Test:

```text
local read/write
remote read
write to wrong region rejected
home region outage
WAN partition
failover
failback
placement change
schema migration per region
backup restore in region
data residency policy
conflict scenario
clock skew
```

Need staging environment with at least simulated multi-region behavior.

---

## 54. Chaos Scenarios

Run controlled tests:

```text
kill one node
isolate one DC
add latency between DCs
drop packets between regions
fail placement service
stale placement cache
wrong local DC config
remote repair load
```

Verify:

- no split-brain,
- no unsafe writes,
- correct degraded mode,
- metrics/alerts fire,
- recovery documented.

---

## 55. Multi-Region Design Checklist

```text
[ ] Why multi-region: latency, DR, residency, or all?
[ ] Keyspace replication strategy defined?
[ ] RF per DC justified?
[ ] Local DC configured per app region?
[ ] CL per operation defined?
[ ] Home region model defined?
[ ] Active-active conflicts handled?
[ ] Global uniqueness strategy defined?
[ ] Data residency constraints enforced?
[ ] Failover runbook written?
[ ] Fencing/epoch mechanism for write failover?
[ ] Backup separate from replication?
[ ] Repair schedule multi-DC aware?
[ ] Backfill/migration region-aware?
[ ] Observability has region/DC dimensions?
[ ] Wrong-region writes blocked?
[ ] DR RPO/RTO explicit?
```

---

## 56. Common Anti-Patterns

### 56.1 Replicate Everywhere Without Requirement

Cost/complexity without clarity.

### 56.2 Global QUORUM by Default

Latency and availability trap.

### 56.3 Active-Active Writes Without Conflict Model

Business corruption.

### 56.4 Wrong Local DC Config

Silent latency/consistency bug.

### 56.5 Automatic Write Failover Without Fencing

Split-brain risk.

### 56.6 Treat Replication as Backup

Corruption/delete replicates too.

### 56.7 Ignore Data Residency in Logs/Search/Backups

Compliance failure.

### 56.8 No Failback Plan

Failover is only half the story.

### 56.9 Standby Without Capacity

RTO promise false.

### 56.10 Clock Timestamp as Domain Order

Clock skew breaks semantics.

---

## 57. Mental Model Compression

Remember:

```text
LOCAL_QUORUM gives local consistency, not global conflict prevention.
Home region gives write ownership.
Failover needs fencing.
Replication is availability, not backup.
Data residency is an architecture constraint, not a tag.
```

And:

```text
Multi-region correctness is mostly application architecture, not just database replication.
```

---

## 58. Summary

Multi-region ScyllaDB design is a trade-off between latency, availability, consistency, compliance, and operational cost.

Key lessons:

1. Use NetworkTopologyStrategy for multi-DC keyspaces.
2. RF is defined per DC.
3. LOCAL_QUORUM is common for local authoritative operations.
4. Global QUORUM/EACH_QUORUM add WAN latency and lower availability.
5. Home region pattern avoids many active-active conflicts.
6. Active-active writes require explicit conflict model.
7. Last-write-wins is not business conflict resolution.
8. Global uniqueness needs a global/home authority.
9. Data residency can forbid replication/backups/logs/search outside region.
10. Java driver local DC config is critical.
11. Writes should route to owner/home region unless failover is active.
12. Automatic write failover without fencing risks split-brain.
13. RPO/RTO must be explicit.
14. Replication is not backup.
15. Multi-DC repair/backfill/schema migration need region-aware runbooks.
16. Standby region must have capacity if low RTO is promised.
17. Observability must include region/DC/placement dimensions.
18. Multi-region correctness is an application+database contract.

---

## 59. Review Questions

1. Mengapa NetworkTopologyStrategy penting untuk multi-DC?
2. Apa arti RF per DC?
3. Apa beda LOCAL_QUORUM dan QUORUM dalam multi-DC?
4. Kenapa global QUORUM bisa menjadi latency trap?
5. Kapan EACH_QUORUM masuk akal?
6. Apa itu home region pattern?
7. Kenapa active-active writes berbahaya untuk current state?
8. Mengapa LWW bukan business conflict resolution?
9. Bagaimana strategi global uniqueness?
10. Apa dampak data residency terhadap replication?
11. Kenapa Java local DC config kritikal?
12. Apa beda read failover dan write failover?
13. Apa itu fencing?
14. Apa beda RPO dan RTO?
15. Mengapa replication bukan backup?
16. Apa yang harus diperhatikan saat multi-DC backfill?
17. Bagaimana failback berbeda dari failover?
18. Apa itu degraded mode?
19. Apa alert multi-region yang penting?
20. Apa anti-pattern multi-region terbesar?

---

## 60. Practical Exercise

Desain multi-region untuk regulatory case platform:

```text
Regions:
- Jakarta
- Singapore

Tenants:
- Indonesian government tenant: data must stay in Indonesia
- Regional enterprise tenant: data can replicate Jakarta/Singapore
- Global tenant: users in both regions, strict case lifecycle
```

Tulis desain:

```text
1. keyspace replication strategy per tenant class
2. tenant placement table
3. Java local DC config per deployment
4. read routing policy
5. write routing policy
6. consistency level per operation
7. global uniqueness strategy
8. active-active or home-region model
9. failover runbook
10. fencing/epoch design
11. backup strategy
12. data residency enforcement
13. search/OLAP projection placement
14. observability metrics
15. chaos test plan
16. degraded mode behavior
```

---

## 61. Preview Part 026

Part berikutnya masuk ke operations:

```text
Operations I:
cluster sizing,
capacity planning,
hardware/cloud instance choices,
disk/IO,
CPU/memory,
shard-per-core implications,
rack/AZ placement,
node lifecycle,
and operational baselines.
```

Part 025 membahas multi-region/multi-DC.

Part 026 mulai membahas operasi cluster dari sisi kapasitas dan deployment.

---

# End of Part 025


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Multi-Tenant ScyllaDB Design: Tenant Isolation, Noisy Neighbor, Hot Tenants, Quotas, dan Operational Controls</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-026.md">Part 026 — Operations I: Cluster Sizing, Capacity Planning, Hardware/Cloud Choices, Disk/IO, CPU/Memory, Shard-per-Core, Rack/AZ Placement, dan Node Lifecycle ➡️</a>
</div>

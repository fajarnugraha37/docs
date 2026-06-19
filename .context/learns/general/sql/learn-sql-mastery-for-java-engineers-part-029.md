# learn-sql-mastery-for-java-engineers-part-029.md

# Part 29 — Partitioning, Sharding, Replication, and Scaling Patterns

> Seri: SQL Mastery for Java Engineers  
> Bagian: 029 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-028.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-030.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas bulk data, ETL, import/export, staging, reconciliation, dan data movement.

Sekarang kita membahas scaling patterns untuk relational database:

```text
partitioning
sharding
replication
read replicas
failover
large tables
tenant scaling
hotspots
data placement
consistency trade-offs
```

Banyak engineer mencoba menyelesaikan semua masalah database dengan:

```text
add index
increase instance size
add read replica
shard it
```

Tetapi scaling database bukan daftar trik. Ia adalah desain trade-off.

Pertanyaan penting:

```text
Apa yang tumbuh?
Rows?
Writes?
Reads?
Tenants?
Hot keys?
History?
Reports?
Storage?
Connections?
Query complexity?
Lock contention?
Operational blast radius?
```

Scaling pattern yang benar bergantung pada bentuk pertumbuhan.

Bagian ini membahas bagaimana memilih strategi secara sadar.

Kalimat inti:

> Scaling relational database bukan hanya membuat database lebih besar; ia adalah membagi data, beban, dan risiko dengan cara yang tetap menjaga correctness, operability, dan evolvability.

---

## 1. Scaling Dimensions

Database bisa “tidak cukup” dalam banyak dimensi.

### 1.1 Storage

Data terlalu besar.

```text
audit_events = 20 TB
case_documents_metadata = 5 TB
```

### 1.2 Read Throughput

Read query terlalu banyak.

```text
dashboard polling
search page
reporting
API list endpoint
```

### 1.3 Write Throughput

Writes terlalu banyak.

```text
event ingestion
bulk import
high-frequency updates
outbox insert
audit logs
```

### 1.4 Query Latency

Query individual lambat.

```text
bad plan
large scan
join explosion
sort spill
```

### 1.5 Contention

Transactions waiting on same rows/indexes.

```text
hot counter
queue row
tenant-level summary row
same account balance
```

### 1.6 Operational Risk

Table too large to vacuum, backup, restore, migrate, or index safely.

Scaling means identifying which dimension is the real bottleneck.

---

## 2. Vertical Scaling

Vertical scaling:

```text
bigger machine
more CPU
more RAM
faster storage
more IOPS
larger cache
better network
```

Pros:

- simple
- no app architecture change
- keeps ACID semantics
- fewer distributed systems problems
- often cheapest engineering-wise

Cons:

- limit exists
- cost grows
- failover/restore time may grow
- big blast radius
- does not solve all contention
- does not solve bad queries

Before sharding, make sure:

- schema sane
- queries indexed
- slow plans fixed
- connection pool tuned
- caching/read models considered
- partitioning considered
- hardware not undersized

Do not shard to avoid learning SQL performance.

---

## 3. Read Scaling

Read scaling options:

```text
better indexes
query rewrite
read model
materialized view
cache
read replica
warehouse
search index
```

Choose by semantics.

If query is slow because it scans huge table:

```text
index/query/read model may solve
```

If OLTP is overloaded by reporting:

```text
replica/warehouse may solve
```

If same expensive dashboard computed repeatedly:

```text
materialized view/cache/read model may solve
```

If full-text fuzzy search:

```text
search engine or FTS index may solve
```

Read replica is not magic if query itself is inefficient.

---

## 4. Write Scaling

Write scaling options:

```text
batching
bulk load
partitioning
remove indexes
reduce secondary indexes
asynchronous processing
append-only log
shard by tenant/key
queue ingestion
backpressure
vertical scaling
write-optimized schema
```

Write bottlenecks often come from:

- too many indexes
- hot rows
- FK checks
- transaction contention
- synchronous side effects
- per-row ORM writes
- random index insert pattern
- large updates
- audit/outbox volume
- disk/WAL saturation

Before sharding writes, reduce unnecessary write amplification.

---

## 5. Partitioning vs Sharding

### 5.1 Partitioning

Partitioning splits one logical table into multiple physical partitions inside same database system.

Application still queries:

```sql
SELECT * FROM audit_events WHERE occurred_at >= ...
```

Database routes/prunes partitions.

### 5.2 Sharding

Sharding splits data across multiple databases/nodes.

Application or routing layer decides shard.

```text
tenant A -> db shard 1
tenant B -> db shard 2
```

Partitioning is usually simpler.

Sharding is distributed system design.

Use partitioning before sharding when it solves the problem.

---

## 6. Partitioning Mental Model

Logical table:

```text
audit_events
```

Physical partitions:

```text
audit_events_2026_01
audit_events_2026_02
audit_events_2026_03
```

Query:

```sql
SELECT *
FROM audit_events
WHERE occurred_at >= '2026-02-01'
  AND occurred_at < '2026-03-01';
```

Database can scan only `audit_events_2026_02`.

This is partition pruning.

Partitioning helps when queries include partition key.

---

## 7. When Partitioning Helps

Partitioning helps for:

- huge time-series/history/audit tables
- retention/drop old data
- bulk load per period
- partition-wise maintenance
- partition pruning
- reducing index size per partition
- isolating hot/cold data
- operational manageability
- archive strategy
- large tenant isolation sometimes

Good candidates:

```text
audit_events by occurred_at
outbox_events by created_at
case_timeline_events by tenant_id or time
measurements by measured_at
import_staging by import_batch_id
report_snapshots by report_month
```

---

## 8. When Partitioning Does Not Help

Partitioning may not help if:

- queries do not filter by partition key
- every query touches all partitions
- partition count too high
- partition key poorly chosen
- global unique constraints needed but unsupported/difficult
- app queries become more complex
- maintenance overhead exceeds benefit
- data is not large enough

Bad:

```sql
SELECT *
FROM audit_events
WHERE actor_id = :actor
```

If partitioned by `occurred_at` but no time predicate, database may scan many partitions.

Partitioning is not automatic speed.

---

## 9. Range Partitioning

Range partitioning splits by ranges.

Common for time:

```text
2026-01
2026-02
2026-03
```

Example conceptual:

```sql
CREATE TABLE audit_events (
    id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL
) PARTITION BY RANGE (occurred_at);
```

Partitions:

```sql
CREATE TABLE audit_events_2026_01
PARTITION OF audit_events
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

Benefits:

- retention by dropping old partitions
- time-window queries prune
- maintenance per partition

---

## 10. List Partitioning

List partitioning splits by discrete values.

Example:

```text
tenant tier
region
jurisdiction
status category
```

Concept:

```sql
PARTITION BY LIST (region_code)
```

Useful if values are few and stable.

Problems if:

- many values
- values change often
- skewed distribution
- queries don't filter by list key

---

## 11. Hash Partitioning

Hash partitioning distributes rows by hash of key.

Example:

```text
hash(tenant_id) modulo N
```

Benefits:

- spreads writes
- avoids huge single partition
- useful when range/list skewed

Limitations:

- retention by time not easy
- range queries not pruned by time unless composite strategy
- changing partition count may be hard
- tenant data spread unless tenant key used

Hash partitioning is for distribution, not lifecycle.

---

## 12. Composite Partitioning

Example:

```text
range by month, hash by tenant within month
```

Useful for:

- time retention
- distribute writes inside time window
- reduce partition size

But complexity increases:

- more partitions
- more maintenance
- more planning
- more indexes
- more operational scripts

Do not over-partition prematurely.

---

## 13. Partition Key Selection

Choose key based on:

```text
common query filters
retention lifecycle
write distribution
maintenance needs
uniqueness constraints
tenant isolation
data skew
```

Questions:

```text
Do most queries include time?
Do we need drop old data?
Do we query by tenant?
Is one tenant huge?
Do we need per-tenant backup/restore?
Do we need global unique keys?
Do writes hotspot recent partition?
```

Partition key is architectural choice.

---

## 14. Partition Pruning

Partition pruning means optimizer skips partitions impossible to match.

Works best when query has explicit partition-key predicate:

```sql
WHERE occurred_at >= :from
  AND occurred_at < :to
```

Bad:

```sql
WHERE date(occurred_at) = :date
```

May prevent pruning/index usage depending DB.

Use sargable predicates:

```sql
WHERE occurred_at >= :day_start
  AND occurred_at < :next_day_start
```

Partitioning and sargability go together.

---

## 15. Partition Indexes

Each partition often has its own indexes.

Pros:

- smaller indexes
- faster maintenance
- partition-specific rebuild
- drop partition drops indexes

Cons:

- many indexes to manage
- global uniqueness difficult in some DBs
- query across partitions may combine many indexes
- planning overhead with too many partitions

Index strategy must match partition strategy.

---

## 16. Unique Constraints with Partitioning

Many databases require partition key to be part of unique constraint.

Example:

```sql
UNIQUE (occurred_at, id)
```

instead of:

```sql
UNIQUE (id)
```

because uniqueness is enforced per partition unless global index exists.

Design primary keys carefully.

If business key must be globally unique, options:

- include partition key
- use separate lookup table
- use generated globally unique UUID with low collision probability, but constraint semantics vary
- use global index if vendor supports
- route key uniqueness elsewhere

Understand target DB behavior.

---

## 17. Partition Retention

Dropping old partition is much faster than deleting rows.

Instead of:

```sql
DELETE FROM audit_events
WHERE occurred_at < :cutoff;
```

Use:

```sql
DROP TABLE audit_events_2024_01;
```

or detach/archive partition.

Benefits:

- instant-ish metadata operation
- less WAL/redo than row delete
- less bloat
- simpler retention

Caveats:

- foreign keys
- backups/legal hold
- archive requirements
- permissions
- dependency views
- replication

Design retention before table reaches TB scale.

---

## 18. Partition Maintenance

Need scheduled operations:

- create future partitions
- drop/detach old partitions
- index new partitions
- analyze partitions
- vacuum partitions
- archive old partitions
- monitor partition sizes
- prevent inserts without partition
- manage default partition

If partition missing, insert can fail or go to default partition depending DB design.

Automation is required.

---

## 19. Hot Recent Partition

Time partitioning often means all writes go to current partition.

This is okay if current partition can handle load.

If current partition is hot:

- use subpartition/hash
- batch writes
- reduce indexes
- separate hot/cold tables
- write buffer/staging
- vertical scale
- shard by tenant/key

Partitioning by time helps retention more than write distribution.

---

## 20. Tenant-Based Partitioning

In multi-tenant systems, partitioning by tenant can help:

- tenant isolation
- per-tenant maintenance
- large tenant management
- query pruning by tenant
- tenant export/delete

But if many tenants:

- too many partitions
- operational overhead
- small partitions
- planning overhead

Hybrid:

```text
big tenants get dedicated partition/database
small tenants share partitioned table
```

This is common in SaaS scaling.

---

## 21. Large Tenant Problem

A multi-tenant system often has skew:

```text
1 tenant = 60% of data
1000 tenants = remaining 40%
```

Hash by tenant may not solve if one tenant huge.

Strategies:

- dedicated database for huge tenant
- tenant tiering
- split huge tenant by region/time/sub-key
- read model per tenant
- archive old tenant data
- custom indexes for huge tenant
- workload isolation

Always measure tenant distribution.

---

## 22. Read Replication

Replication copies data from primary to replicas.

Common architecture:

```text
primary handles writes
replicas handle reads
```

Benefits:

- offload read traffic
- reporting on replica
- HA/failover
- backups from replica
- geo-read locality

Costs:

- replica lag
- read-your-writes issues
- failover complexity
- replica query conflicts
- more operational monitoring
- eventual consistency for replica reads

Read replica is not transparent if consistency matters.

---

## 23. Synchronous vs Asynchronous Replication

### 23.1 Asynchronous

Primary commits before replica confirms.

Pros:

- lower write latency
- common/default

Cons:

- replica lag
- possible data loss on failover
- stale reads

### 23.2 Synchronous

Primary waits for replica acknowledgment.

Pros:

- stronger durability/less data loss

Cons:

- higher latency
- availability risk if replica slow/down
- throughput impact

Choose based on RPO/RTO and latency requirements.

---

## 24. Replica Lag

Replica lag means replica is behind primary.

If user writes then reads from replica:

```text
POST close case -> primary commit
GET case -> replica still says OPEN
```

This violates read-your-writes.

Solutions:

- read from primary after write
- session stickiness to primary for short window
- lag-aware routing
- wait for replica catch-up
- consistency token/LSN
- design UI eventual
- do not use replica for critical command validation

Replica reads are eventually consistent unless managed.

---

## 25. Read Routing

App must decide:

```text
read from primary or replica?
```

Rules:

Read from primary for:

- immediately after write
- command validation
- transactions requiring locks
- strongly consistent user flows
- idempotency checks
- current authorization-sensitive data if stale unsafe

Read from replica for:

- dashboards
- reports
- search/list where staleness acceptable
- exports
- analytics
- read-only heavy queries

Do not blindly route all SELECTs to replicas.

---

## 26. Read-Only Transaction Routing

Some frameworks route `@Transactional(readOnly = true)` to replica.

Danger:

```java
@Transactional(readOnly = true)
public CaseDto getAfterClose(...)
```

If called immediately after write, stale.

Also `readOnly=true` does not mean stale is acceptable.

Routing should consider consistency context, not only annotation.

---

## 27. Failover

Failover promotes replica to primary after primary failure.

Questions:

```text
How detect failure?
Automatic or manual?
What data loss possible?
How clients reconnect?
What happens to old primary?
How avoid split brain?
How long outage?
Are sequences/IDs safe?
Are app connections reset?
Are in-flight transactions retried?
```

Failover is an application concern too.

Java app must handle:

- connection failures
- transaction retry where safe
- pool reset
- DNS/endpoint change
- idempotency for ambiguous commits

---

## 28. Split Brain

Split brain occurs when two nodes accept writes as primary.

This can corrupt data.

Avoid through:

- consensus/quorum
- fencing old primary
- managed failover
- strong operational procedures
- no manual “just point app here” without fencing
- clear ownership

Application-level conflict resolution after split brain is painful.

---

## 29. Backups vs Replicas

Replica is not backup.

If user/app deletes data on primary:

```text
DELETE FROM cases;
```

replica replicates delete.

Backup/PITR needed to recover past state.

Use:

- backups
- point-in-time recovery
- snapshots
- logical exports
- immutable archive
- audit/history

Replication improves availability/read scaling, not historical recovery by itself.

---

## 30. Sharding

Sharding splits data across multiple databases.

Example:

```text
tenant_id hash:
  shard 0 -> db0
  shard 1 -> db1
  shard 2 -> db2
```

Application/router determines shard.

Benefits:

- scale writes/storage beyond one DB
- isolate tenants/workloads
- reduce blast radius
- independent maintenance
- horizontal growth

Costs:

- cross-shard queries hard
- cross-shard transactions hard
- global uniqueness hard
- rebalancing hard
- migrations multiply
- operational complexity
- reporting complexity
- failover per shard
- connection pools per shard
- tenant movement

Sharding is a major architectural commitment.

---

## 31. Shard Key

Shard key determines data placement.

Common shard keys:

```text
tenant_id
account_id
user_id
organization_id
region
hash(entity_id)
```

Good shard key:

- present in most queries
- high cardinality
- evenly distributed
- aligns with transaction boundaries
- minimizes cross-shard joins
- stable over time
- supports data ownership model

Bad shard key:

- low cardinality
- skewed
- frequently changes
- not available in queries
- cuts across transactions
- creates cross-shard workflows

Shard key is one of the hardest decisions.

---

## 32. Tenant Sharding

For SaaS, tenant_id is common shard key.

Benefits:

- tenant data colocated
- tenant-level isolation
- per-tenant backup/export
- per-tenant migration
- noisy tenant isolation
- authorization boundary alignment

Problems:

- large tenant skew
- cross-tenant analytics difficult
- moving tenant between shards
- shared reference data
- global admin queries
- many small tenants

Tenant sharding is usually easier than entity hash sharding for business apps.

---

## 33. Shard Routing Table

Route tenants to shards.

```sql
CREATE TABLE tenant_shard_map (
    tenant_id UUID PRIMARY KEY,
    shard_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL
);
```

Application flow:

```text
extract tenant_id
lookup shard_id
get DataSource for shard
execute query on shard
```

Cache shard map carefully.

Shard map itself must be highly available and consistent.

---

## 34. Application Architecture for Shards

Need:

- routing layer
- per-shard DataSource/pool
- migration orchestration per shard
- health checks per shard
- metrics tagged by shard
- backup per shard
- failover per shard
- tenant move tooling
- cross-shard query strategy
- operational dashboards

Sharding multiplies everything.

If you have 50 shards, migration is 50 operations.

---

## 35. Cross-Shard Queries

Cross-shard query options:

### 35.1 Fan-Out Query

Ask all shards, merge results.

Good for admin/reporting with low frequency.

Bad for latency/load.

### 35.2 Warehouse

Replicate data to analytical store.

Better for global analytics.

### 35.3 Global Index / Directory

Keep small lookup table mapping global key to shard.

### 35.4 Restrict Product Requirements

Design product so most operations are tenant-scoped.

The best cross-shard query is the one product does not need synchronously.

---

## 36. Cross-Shard Transactions

Avoid if possible.

Options:

- two-phase commit
- saga/compensation
- outbox/inbox
- eventual consistency
- redesign aggregate boundary
- colocate data by shard key

2PC adds complexity and availability trade-offs.

Most scalable systems avoid synchronous cross-shard transactions in business flows.

---

## 37. Global IDs

In sharded systems, IDs must be unique without central bottleneck.

Options:

- UUID
- ULID/time-ordered UUID
- Snowflake-style IDs
- database sequence per shard with shard prefix
- composite key `(shard_id, local_id)`

Consider:

- index locality
- sorting by creation time
- information leakage
- ID length
- client generation
- collision risk
- operational debugging

Globally unique IDs simplify cross-system references.

---

## 38. Rebalancing Shards

Tenant grows; need move tenant.

Steps:

1. mark tenant moving
2. stop or dual-write tenant traffic
3. copy tenant data to target shard
4. validate counts/checksums
5. catch up changes
6. update routing map
7. monitor
8. retire old copy

This is hard.

Design tenant data with clear boundaries and composite tenant FKs to make movement possible.

---

## 39. Dedicated Tenant Databases

For enterprise SaaS:

```text
small tenants shared DB
large tenants dedicated DB
regulated tenants dedicated cluster
```

Benefits:

- isolation
- custom maintenance
- per-tenant scaling
- easier compliance
- reduced noisy neighbor

Costs:

- operational overhead
- many databases
- migration orchestration
- monitoring complexity
- cost
- connection management

This hybrid model is common.

---

## 40. Reference Data in Sharded Systems

Reference data options:

- replicate to every shard
- central reference service
- embed snapshot in tenant data
- versioned reference tables per shard
- global database for reference

Examples:

```text
countries
currencies
SLA rules
case types
jurisdictions
```

If reference data affects historical correctness, version it and propagate changes carefully.

---

## 41. Multi-Region Replication

Reasons:

- low-latency reads near users
- disaster recovery
- regulatory data residency
- high availability

Patterns:

- single primary region + read replicas elsewhere
- active-passive
- active-active
- region-sharded by tenant/user
- distributed SQL database

Trade-offs:

- latency
- consistency
- conflict resolution
- failover
- data residency
- operational complexity

Multi-region writes are hard.

---

## 42. Active-Active Writes

Active-active means multiple regions accept writes.

Problems:

- conflict resolution
- ordering
- uniqueness
- referential integrity
- distributed transactions
- clock/time issues
- user sees divergent states
- eventual convergence

Use only with domain designed for it.

Examples better suited:

- append-only events with conflict-free IDs
- user-local preferences
- collaborative data with CRDT-like semantics
- region-owned tenants

Not good for arbitrary relational workflows requiring strict consistency.

---

## 43. Distributed SQL

Distributed SQL databases aim to provide SQL over distributed storage.

Examples category:

```text
Spanner-like systems
CockroachDB-like systems
Yugabyte-like systems
```

Benefits:

- horizontal scaling
- SQL interface
- distributed transactions
- resilience
- sometimes global consistency

Trade-offs:

- latency for distributed transactions
- schema/index design still matters
- hotspot keys still possible
- operational complexity
- vendor-specific behavior
- cost
- consistency model understanding required

Distributed SQL does not remove data modelling and query design.

---

## 44. Caching

Cache can reduce read load.

Types:

- application memory cache
- distributed cache
- CDN
- query result cache
- entity cache
- materialized view
- read model

Cache trade-offs:

- invalidation
- stale data
- stampede
- memory
- consistency
- security/tenant isolation
- eviction
- observability

Cache should have clear freshness semantics.

Do not use cache to hide permanently broken query design without understanding.

---

## 45. Cache Aside Pattern

Flow:

```text
read cache
if miss, read DB
store cache
return
```

Write:

```text
update DB
invalidate cache
```

Problems:

- race conditions
- stale cache
- cache stampede
- invalidation failure
- partial outages
- tenant leakage if keys wrong

Cache key must include tenant/security context.

Example key:

```text
tenant:{tenantId}:case:{caseId}:summary
```

---

## 46. Hot Keys

Hot key:

```text
one key receives disproportionate traffic
```

Examples:

- tenant dashboard summary
- global settings
- latest feed
- counter row
- queue head
- popular case
- same cache key

Solutions:

- shard key
- cache with request coalescing
- precompute
- split counter
- append-only events
- rate limit
- batch updates
- denormalize
- distribute load by bucket

Scaling average load is easier than hot spots.

---

## 47. Connection Scaling

App replicas × pool size = total possible DB connections.

Example:

```text
50 app pods × pool size 20 = 1000 DB connections
```

DB may not handle that.

Solutions:

- smaller pools
- connection proxy/pooler
- app concurrency limits
- backpressure
- async job throttling
- read/write pool separation
- per-shard pool management

More app pods can overload DB.

---

## 48. Backpressure

When DB overloaded, app should not keep increasing pressure.

Backpressure mechanisms:

- connection pool max size
- request rate limit
- queue limits
- circuit breakers
- bulkhead pools
- job throttling
- reject low-priority work
- shed load
- lock timeout
- statement timeout

Without backpressure, failure cascades.

---

## 49. Scaling Writes with Queue

For non-interactive writes:

```text
API accepts command -> queue/outbox -> worker processes
```

Benefits:

- smooth bursts
- retry
- throttle DB writes
- isolate heavy work
- backpressure users
- preserve order per key if designed

Caveats:

- eventual consistency
- idempotency
- duplicate processing
- queue lag
- operational complexity

Use for heavy imports/projections/notifications, not necessarily immediate critical writes.

---

## 50. Archiving and Cold Storage

Not all data needs to remain in hot OLTP tables.

Options:

- partition retention
- archive schema
- cheaper storage
- warehouse/lake
- object storage
- compressed historical tables
- summary tables
- report snapshots

Questions:

```text
How often queried?
By whom?
Latency requirement?
Legal retention?
Redaction requirement?
Restore path?
```

Hot/cold separation improves OLTP performance.

---

## 51. Scaling Large Audit Tables

Audit grows forever.

Strategy:

- partition by time
- append-only
- minimal indexes on hot path
- separate technical audit vs business timeline
- archive old partitions
- BRIN/time-correlated indexes if supported
- retention/legal hold
- query by entity/time indexes
- avoid large JSON indexing unless needed
- compress/archive cold data

Audit table design is scaling design.

---

## 52. Scaling Outbox

Outbox can become hot.

Design:

- partition by created_at
- partial index on unpublished
- batch publisher
- `FOR UPDATE SKIP LOCKED`
- mark published idempotently
- archive published events
- monitor lag
- dead-letter failed events
- avoid huge payload
- event versioning

Index:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;
```

This keeps publisher efficient.

---

## 53. Scaling Multi-Tenant OLTP

Checklist:

```text
tenant_id on every tenant-scoped table
tenant-scoped indexes
composite tenant FKs
per-tenant metrics
identify large tenants
tenant-aware rate limits
tenant-aware exports/imports
tenant-aware archival
RLS or tenant filter tests
dedicated shard/db for large tenants
```

Tenant is not just column; it is scaling dimension.

---

## 54. Scaling Reports

Do not run heavy reports on hot OLTP primary.

Options:

- read replica
- materialized views
- reporting schema
- warehouse
- snapshot tables
- async report jobs
- pre-aggregated summaries
- partitioned report tables
- caching

Report freshness must be explicit.

```text
real-time
near real-time
hourly
daily
as submitted
```

---

## 55. Scaling Search

Relational options:

- B-tree prefix search
- trigram index
- full-text index
- JSON expression index

External search engine options:

- Elasticsearch/OpenSearch/Solr
- specialized search services

External search trade-offs:

- async indexing
- stale results
- relevance tuning
- security filtering
- reindexing
- schema evolution
- operational complexity
- source-of-truth mismatch

Search index is read model, not source of truth.

---

## 56. Scaling Decision Framework

Before choosing pattern, ask:

```text
What exactly is bottleneck?
Can query/index/schema fix it?
Can read model/materialized view fix it?
Can vertical scaling buy time?
Can partitioning solve lifecycle/size?
Can replica offload reads?
Can cache solve repeated reads?
Can async processing smooth writes?
Is sharding truly necessary?
What correctness is lost?
What operations become harder?
```

Scaling pattern should be tied to measured bottleneck.

---

## 57. Anti-Patterns

```text
[ ] shard before fixing slow queries
[ ] add read replica for write bottleneck
[ ] use replica for command validation requiring fresh data
[ ] partition table but queries do not include partition key
[ ] create thousands of tiny partitions
[ ] ignore tenant skew
[ ] no shard move plan
[ ] cross-shard transaction in core user flow
[ ] cache without invalidation strategy
[ ] app pods multiplied without reducing pool size
[ ] no replication lag monitoring
[ ] treat replica as backup
[ ] failover not tested
[ ] global report fan-out over all shards per request
[ ] external search treated as source of truth
```

---

## 58. Design Checklist

```text
[ ] What bottleneck are we solving?
[ ] Is workload read, write, storage, contention, or operations?
[ ] Are query plans optimized first?
[ ] Are indexes appropriate?
[ ] Would read model/materialized view help?
[ ] Would partitioning help with pruning or retention?
[ ] What is partition key?
[ ] Are queries including partition key?
[ ] Are unique constraints compatible with partitioning?
[ ] Is retention strategy defined?
[ ] Is replica lag acceptable?
[ ] Which reads require primary?
[ ] Is failover tested?
[ ] Is sharding truly required?
[ ] What is shard key?
[ ] Are cross-shard operations avoided?
[ ] Is tenant skew measured?
[ ] Are backups/PITR tested?
[ ] Are pool sizes controlled?
[ ] Are scaling metrics monitored?
```

---

## 59. Practical Exercises

### Exercise 1 — Partition Audit Events

Design monthly range partitioning for `audit_events`. Include retention and query requirement.

### Exercise 2 — Replica Read Routing

Given `POST /cases/{id}/close` followed by `GET /cases/{id}`, decide primary vs replica read and explain.

### Exercise 3 — Tenant Sharding

Design shard routing table for tenant-based sharding and list operational responsibilities.

### Exercise 4 — Hot Counter

A global counter row is updated 5000 times/sec. Propose alternatives.

### Exercise 5 — Large Tenant

One tenant has 70% of all data. Propose scaling strategy.

---

## 60. Koneksi ke Part Berikutnya

Part ini membahas partitioning, sharding, replication, and scaling patterns.

Part berikutnya, `part-030`, akan membahas database operations and reliability:

- observability
- monitoring
- slow query logs
- backup
- restore
- PITR
- disaster recovery
- maintenance
- vacuum/analyze
- capacity planning
- incident response

Scaling tanpa operations yang kuat hanya memindahkan masalah.

---

## 61. Ringkasan Bagian Ini

Hal penting dari part 029:

1. Scaling database harus dimulai dari bottleneck yang jelas.
2. Vertical scaling sering solusi paling sederhana sebelum distributed complexity.
3. Read scaling, write scaling, storage scaling, and contention scaling berbeda.
4. Partitioning membagi table dalam satu database; sharding membagi data antar database.
5. Partitioning membantu jika query/retention sesuai partition key.
6. Partition pruning butuh predicate yang sargable pada partition key.
7. Partitioning tidak otomatis mempercepat query yang menyentuh semua partitions.
8. Unique constraints and indexes become more complex with partitioning.
9. Time partitioning excellent for audit/history retention.
10. Tenant skew is common and must be measured.
11. Read replicas offload reads but introduce replica lag.
12. Read-your-writes requires primary read or consistency strategy.
13. Replica is not backup.
14. Failover must be tested and app must handle connection/transaction failures.
15. Sharding is major architecture commitment with cross-shard complexity.
16. Shard key should align with transaction and query boundaries.
17. Cross-shard transactions should be avoided in core flows.
18. Caching needs invalidation, freshness, and tenant-safe keys.
19. Connection pool scaling can overload DB if app pods multiply.
20. Scaling pattern must preserve correctness, operability, and security.

Kalimat inti:

> Database scaling yang matang bukan memilih teknologi paling besar, tetapi memilih pembagian data dan beban yang sesuai dengan query, tenant, consistency, lifecycle, dan operasi production.

---

## 62. Referensi

1. PostgreSQL Documentation — Table Partitioning.  
   https://www.postgresql.org/docs/current/ddl-partitioning.html

2. PostgreSQL Documentation — High Availability, Load Balancing, and Replication.  
   https://www.postgresql.org/docs/current/high-availability.html

3. PostgreSQL Documentation — Streaming Replication.  
   https://www.postgresql.org/docs/current/warm-standby.html

4. MySQL Documentation — Partitioning.  
   https://dev.mysql.com/doc/refman/8.4/en/partitioning.html

5. MySQL Documentation — Replication.  
   https://dev.mysql.com/doc/refman/8.4/en/replication.html

6. SQL Server Documentation — Partitioned Tables and Indexes.  
   https://learn.microsoft.com/en-us/sql/relational-databases/partitions/partitioned-tables-and-indexes

7. SQL Server Documentation — Always On Availability Groups.  
   https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/overview-of-always-on-availability-groups-sql-server

8. Oracle Documentation — Partitioning Guide.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/vldbg/

9. Martin Kleppmann — Designing Data-Intensive Applications.  
   https://dataintensive.net/

---

## 63. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-030.md` — Observability, Operations, Backup, Restore, and Disaster Recovery

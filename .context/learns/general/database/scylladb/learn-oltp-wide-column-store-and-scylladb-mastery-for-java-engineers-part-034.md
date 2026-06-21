# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-034.md

# Part 034 — Capstone: End-to-End Design of a ScyllaDB-Backed Regulatory Case Platform

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `034`  
> Status: **bagian terakhir seri**  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: capstone end-to-end: requirements, domain model, access pattern, CQL schema, Java service architecture, correctness, idempotency, LWT, event log, derived tables, backfill, multi-tenancy, multi-region, operations, observability, security, migration, and production readiness review.

---

## 0. Posisi Part Ini dalam Seri

Ini adalah bagian terakhir.

Seluruh part sebelumnya membangun fondasi:

```text
000 orientation
001 mental model wide-column
002 distributed OLTP constraints
003 Dynamo lineage
004 ScyllaDB architecture
005 tablets/vnodes/token distribution
006 storage engine
007 CQL
008 primary key design
009 query-first modeling
010 partition sizing
011 time-series modeling
012 multi-access-pattern design
013 consistency levels
014 LWT
015 tombstones
016 compaction
017 indexes/MV
018 counters/static/collections/UDT
019 Java client I
020 Java client II
021 query performance
022 batching/backfill
023 schema evolution
024 multi-tenant
025 multi-region
026 operations sizing
027 operations lifecycle
028 backup/restore/DR
029 observability
030 failure modelling
031 correctness patterns
032 security/compliance
033 migration/interoperability
```

Part ini menyatukan semuanya dalam satu desain sistem:

```text
Regulatory Case Platform
```

Bukan sebagai “contoh mainan”, tetapi sebagai internal engineering design review.

---

## 1. Problem Statement

Kita membangun platform regulatory case management multi-tenant.

Platform digunakan oleh:

- government agency,
- enterprise compliance team,
- internal investigators,
- auditors,
- external reviewers.

Core workflow:

```text
case created
case assigned
case reviewed
case transitioned
evidence attached
comments added
notifications sent
audit retained
exports generated
search/reporting integrated
privacy deletion/legal hold supported
```

Scale target:

```text
10,000 small tenants
100 medium tenants
5 mega tenants
multi-region deployment
high write volume event/audit logs
low-latency operational reads
strict tenant isolation
regulated data handling
```

---

## 2. Requirements

### 2.1 Functional Requirements

```text
FR1: Create case.
FR2: Read case current state by case_id.
FR3: List open cases by assignee ordered by due_at.
FR4: List case events/audit history.
FR5: Transition case state with optimistic concurrency.
FR6: Assign/reassign case.
FR7: Attach evidence metadata.
FR8: Search cases by text/custom fields.
FR9: Notify assignee/watchers.
FR10: Export tenant data.
FR11: Privacy deletion / anonymization.
FR12: Legal hold.
FR13: Admin audit.
```

### 2.2 Non-Functional Requirements

```text
NFR1: p99 case detail read < 200ms under normal load.
NFR2: p99 case transition < 800ms for uncontended case.
NFR3: assignee queue p99 < 300ms.
NFR4: derived views eventually consistent within 30s p99.
NFR5: no cross-tenant data leak.
NFR6: command retry must be idempotent.
NFR7: audit event must not be lost.
NFR8: restore must not resurrect privacy-deleted data.
NFR9: multi-region data residency supported.
NFR10: backfills must not degrade foreground SLO.
```

---

## 3. Architecture Overview

High-level components:

```text
API Gateway
  -> Case Command Service
  -> Case Query Service
  -> Projection Workers
  -> Notification Worker
  -> Search Indexer
  -> Export/Backfill Workers
  -> Admin/Audit Service

ScyllaDB:
  - current state tables
  - event/audit tables
  - derived query tables
  - idempotency/command tables
  - tenant metadata
  - projection checkpoints

External:
  - Kafka/event stream optional
  - object storage for evidence
  - search engine
  - OLAP/warehouse
  - secrets/KMS
  - observability stack
```

Core principle:

```text
ScyllaDB serves high-scale OLTP access patterns.
Search/OLAP/object storage are separate systems.
```

---

## 4. Source and Derived Authority Matrix

| Data | Source of Truth | Derived/Rebuildable | Notes |
|---|---|---|---|
| Case current state | `case_current_by_id` + event log | no | guarded by version/LWT |
| Case audit history | `case_events_by_case_version_bucket` | no | append-only, backed up |
| Assignee queue | source current/events | `open_cases_by_assignee_day_bucket` | derived |
| External ref lookup | reserved mapping | `case_id_by_external_ref` | uniqueness guard |
| Notifications feed | event/projector | `notifications_by_user_day` | derived/product state |
| Search index | current/events | external search | rebuild |
| Dashboard aggregates | events/current | OLAP/aggregate tables | rebuild |
| Evidence binary | object storage | DB metadata references | hash validated |
| Privacy deletion | deletion log | projections apply deletes | must replay after restore |

---

## 5. Tenant Model

Tenant metadata:

```sql
CREATE TABLE tenant_metadata_by_id (
    tenant_id uuid PRIMARY KEY,
    tenant_slug text,
    tier text,
    status text,
    home_region text,
    home_dc text,
    residency_policy text,
    retention_policy text,
    placement_type text,
    keyspace_name text,
    cluster_id text,
    created_at timestamp,
    updated_at timestamp
);
```

Rules:

```text
tenant_id comes from auth context
repository methods require TenantId
cache/search/object keys include tenant_id
admin cross-tenant access audited
tenant placement controls region/keyspace/cluster
```

---

## 6. Case Current Table

Access pattern:

```text
read current case by tenant_id + case_id
transition current case by expected version
```

Schema:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    external_ref text,
    status text,
    assignee_id uuid,
    due_at timestamp,
    priority text,
    title text,
    summary text,
    version bigint,
    last_event_id uuid,
    last_command_id uuid,
    legal_hold boolean,
    pii_profile text,
    created_at timestamp,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Design notes:

```text
partition key includes tenant_id
one case current row per case
version is optimistic concurrency guard
last_event_id helps resolve timeout unknown
legal_hold affects retention/deletion
summary/title duplication must follow PII policy
```

---

## 7. Case Event Log Table

Access pattern:

```text
list events for a case ordered by event_version/time
append audit event
rebuild current/derived from events
```

Schema:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    command_id uuid,
    event_type text,
    actor_id uuid,
    actor_type text,
    source_region text,
    schema_version int,
    payload text,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version ASC, event_id ASC);
```

Bucket:

```text
version_bucket = event_version / 10000
```

Why:

```text
avoid unbounded huge partition for long-lived cases
```

---

## 8. Assignee Queue Derived Table

Access pattern:

```text
list open cases for assignee by day/bucket ordered by due_at
```

Schema:

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    tenant_id uuid,
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    source_version bigint,
    projection_version int,
    status text,
    priority text,
    title text,
    projected_at timestamp,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
) WITH CLUSTERING ORDER BY (due_at ASC, case_id ASC);
```

Rules:

```text
derived, not source
source_version detects stale rows
projection_version supports schema evolution
bucket_id prevents hot partitions
reader may validate/fallback if source_version stale
```

---

## 9. External Reference Uniqueness

Requirement:

```text
external_ref unique per tenant
```

Schema:

```sql
CREATE TABLE case_id_by_external_ref (
    tenant_id uuid,
    external_ref text,
    case_id uuid,
    command_id uuid,
    status text,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

Reservation:

```sql
INSERT INTO case_id_by_external_ref (
    tenant_id, external_ref, case_id, command_id, status, created_at
)
VALUES (?, ?, ?, ?, 'CONFIRMED', ?)
IF NOT EXISTS;
```

If not applied:

```text
read existing case_id
return duplicate/conflict
```

---

## 10. Command Idempotency Table

Schema:

```sql
CREATE TABLE command_result_by_id (
    tenant_id uuid,
    command_id uuid,
    command_type text,
    target_type text,
    target_id uuid,
    status text,
    result_code text,
    result_payload text,
    error_code text,
    created_at timestamp,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, command_id))
);
```

Use cases:

```text
duplicate client retry
timeout unknown resolution
saga progress
repair missing event
auditable command outcome
```

Reservation:

```sql
INSERT ... IF NOT EXISTS;
```

---

## 11. Privacy Deletion Log

Schema:

```sql
CREATE TABLE privacy_deletions_by_time (
    bucket_day date,
    deletion_time timestamp,
    deletion_id uuid,
    tenant_id uuid,
    subject_type text,
    subject_id text,
    actor_id uuid,
    reason text,
    status text,
    PRIMARY KEY ((bucket_day), deletion_time, deletion_id)
) WITH CLUSTERING ORDER BY (deletion_time ASC, deletion_id ASC);
```

Use:

```text
live deletion workflow
restore deletion replay
compliance audit
validator input
```

---

## 12. Audit Events Table

Admin/security/business audit:

```sql
CREATE TABLE audit_events_by_tenant_day (
    tenant_id uuid,
    bucket_day date,
    event_time timestamp,
    audit_event_id uuid,
    actor_id uuid,
    actor_type text,
    action text,
    target_type text,
    target_id text,
    command_id uuid,
    reason text,
    metadata text,
    PRIMARY KEY ((tenant_id, bucket_day), event_time, audit_event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, audit_event_id ASC);
```

Audit should be append-only and protected with restricted credentials/retention.

---

## 13. Evidence Metadata

Binary evidence belongs in object storage.

ScyllaDB stores metadata:

```sql
CREATE TABLE evidence_by_case (
    tenant_id uuid,
    case_id uuid,
    evidence_id uuid,
    object_key text,
    object_version text,
    sha256 text,
    content_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp,
    legal_hold boolean,
    PRIMARY KEY ((tenant_id, case_id), evidence_id)
);
```

Rules:

```text
object key tenant-scoped
object storage encrypted
hash validates integrity
legal hold controls deletion
```

---

## 14. Notification Feed

Schema:

```sql
CREATE TABLE notifications_by_user_day (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    notification_time timestamp,
    notification_id uuid,
    source_event_id uuid,
    case_id uuid,
    notification_type text,
    read_at timestamp,
    payload_summary text,
    PRIMARY KEY ((tenant_id, user_id, bucket_day), notification_time, notification_id)
) WITH CLUSTERING ORDER BY (notification_time DESC, notification_id ASC);
```

Design notes:

```text
derived/product state
TTL may apply if retention allows
payload_summary must avoid high-risk PII
notification_id stable for idempotent publish
```

---

## 15. Java Service Boundaries

### Case Command Service

Owns:

- create case,
- transition case,
- assign case,
- attach evidence metadata,
- privacy deletion command.

Uses:

- command idempotency,
- LWT for current state,
- event append,
- async projection trigger.

### Case Query Service

Owns:

- case detail read,
- assignee queue,
- event history,
- current status.

Uses:

- repository metrics,
- source/derived fallback,
- cursor versioning.

### Projection Workers

Own:

- assignee queue updates,
- notifications,
- search indexing,
- aggregate updates.

Uses:

- idempotent writes,
- checkpoints,
- DLQ,
- source_version.

---

## 16. Java Repository API

Good repository methods encode invariants:

```java
CompletionStage<CaseCurrent> findCurrent(
    TenantId tenantId,
    CaseId caseId,
    ConsistencyProfile profile
);

CompletionStage<TransitionResult> transitionIfExpectedVersion(
    TenantId tenantId,
    CaseId caseId,
    long expectedVersion,
    CaseStatus expectedStatus,
    CaseStatus newStatus,
    CommandId commandId,
    EventId eventId,
    Instant now
);

CompletionStage<CommandReservationResult> reserveCommand(
    TenantId tenantId,
    CommandId commandId,
    CommandType type,
    TargetId targetId
);
```

Avoid generic:

```java
save(Object entity)
updateStatus(String status)
findById(caseId)
```

---

## 17. Case Transition Flow

Flow:

```text
1. authenticate user
2. resolve tenant_id from auth context
3. validate permission
4. parse command_id
5. reserve command IF NOT EXISTS
6. if duplicate, return stored result
7. read current case
8. validate state transition
9. LWT update current with expected version/status
10. insert event with stable event_id/version
11. store command result APPLIED
12. enqueue/project derived updates
13. return new version and state
```

Failure handling:

```text
LWT conflict -> 409
LWT timeout -> read current/command result
event insert timeout -> retry same event_id
derived failure -> reconcile later
```

---

## 18. LWT Transition Statement

```sql
UPDATE case_current_by_id
SET status = ?,
    assignee_id = ?,
    due_at = ?,
    version = ?,
    last_event_id = ?,
    last_command_id = ?,
    updated_at = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = ?
   AND version = ?;
```

Rationale:

```text
prevents lost update
encodes valid expected state
supports timeout resolution through last_event_id/command_id
```

---

## 19. Event Insert

```sql
INSERT INTO case_events_by_case_version_bucket (
    tenant_id,
    case_id,
    version_bucket,
    event_version,
    event_id,
    command_id,
    event_type,
    actor_id,
    actor_type,
    source_region,
    schema_version,
    payload,
    created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

Idempotency:

```text
event_id generated once
event_version derived from current transition
retry uses same values
```

---

## 20. Derived Projection Update

When case becomes OPEN assigned to user A:

```text
insert open_cases row for A
```

When reassigned A -> B:

```text
delete old A row
insert new B row
```

Projection worker needs old and new state.

Event payload should include:

```text
previous_assignee_id
new_assignee_id
previous_due_at
new_due_at
previous_status
new_status
previous_version
new_version
```

Without old key, cleanup is hard.

---

## 21. Assignee Queue Read Path

Input:

```text
tenant_id
assignee_id
date range
limit
cursor
```

Process:

```text
1. compute bucket_day(s)
2. compute bucket_ids
3. bounded fanout reads
4. merge sorted results by due_at/case_id
5. optionally validate source_version for top N
6. filter stale/closed rows
7. return signed cursor
```

Cursor includes:

```json
{
  "v": 2,
  "bucketDay": "2026-06-21",
  "bucketId": 3,
  "lastDueAt": "...",
  "lastCaseId": "...",
  "tenantHash": "...",
  "expiresAt": "..."
}
```

Cursor signed/encrypted as needed.

---

## 22. Consistency Profiles

Example:

```text
source-authoritative-read:
  CL LOCAL_QUORUM
  timeout 300ms

source-transition-lwt:
  CL LOCAL_QUORUM
  serial CL LOCAL_SERIAL
  timeout 800ms

derived-fast-read:
  CL LOCAL_ONE
  timeout 150ms

idempotency-lwt:
  CL LOCAL_QUORUM
  serial CL LOCAL_SERIAL
  timeout 500ms

backfill-derived-write:
  CL LOCAL_ONE or LOCAL_QUORUM based on policy
  low priority profile
```

Do not use one global CL.

---

## 23. Idempotency and Timeout Policy

### Read Timeout

```text
retry within deadline or return degraded/timeout
```

### Source Write Timeout

```text
unknown outcome
resolve with command_id/current row
```

### LWT Timeout

```text
read current + command_result
return applied/conflict/pending
```

### Derived Write Timeout

```text
retry idempotently
or send to reconciliation/DLQ
```

### Notification Publish Timeout

```text
retry same notification_id
```

---

## 24. Correctness Invariants

Core invariants:

```text
I1: command_id maps to one final result.
I2: case_current.version monotonically increases.
I3: case_current.last_event_id points to event log eventually.
I4: case event_version unique per case.
I5: invalid state transitions are rejected.
I6: external_ref unique per tenant.
I7: open_cases view eventually matches current OPEN assigned cases.
I8: privacy-deleted subject absent from source/derived/search after workflow completes.
I9: legal hold prevents retention deletion.
I10: tenant_id scoped access only.
```

Validators should check these.

---

## 25. Reconciliation Jobs

Jobs:

```text
current_event_consistency_validator
open_cases_projection_reconciler
external_ref_validator
privacy_deletion_validator
search_index_reconciler
notification_dedupe_validator
```

Each has:

- checkpoint,
- throttle,
- DLQ,
- metrics,
- tenant scope,
- repair mode.

---

## 26. Backfill Strategy

For new derived table:

```text
1. create v2 table
2. deploy dual-write/projection v2
3. backfill from source current/events
4. validate
5. shadow read
6. cutover per tenant
7. keep fallback
8. retire v1 later
```

Backfill rules:

```text
idempotent target keys
source_version included
checkpoint after success
per-tenant throttle
pause/kill switch
DLQ secured
```

---

## 27. Multi-Tenant Controls

Per tenant:

```text
read QPS limit
write QPS limit
max in-flight
export concurrency
backfill concurrency
page size
date range
storage quota
retention policy
```

Noisy neighbor controls:

```text
tenant throttle
feature degrade
pause export
move mega tenant
dedicated cluster option
```

Metrics use top-N tenant visibility.

---

## 28. Multi-Region Design

Use home region.

Tenant placement:

```text
tenant_id -> home_region/home_dc/keyspace/cluster
```

Writes route to home.

Reads:

```text
authoritative read -> home or local if replicated and semantics allow
derived read -> local if stale acceptable
```

Consistency:

```text
LOCAL_QUORUM in home DC for source writes
LOCAL_ONE/LOCAL_QUORUM for reads by semantics
```

Failover:

```text
manual/operator-controlled
fencing epoch
degraded mode
no active-active state transition without conflict model
```

---

## 29. Data Residency

Tenant metadata controls allowed regions.

Policy:

```text
ID-only tenants stay in ID keyspace/cluster
EU-only tenants stay in EU
global tenants replicate to allowed DCs
backups/logs/search/OLAP follow residency
```

Application must not write tenant data to wrong region.

Wrong-region write guard is required.

---

## 30. Capacity Planning Summary

Estimate:

```text
logical data
* RF
* space amplification
* headroom
```

Plus:

```text
write amplification per command
read fanout per endpoint
tenant skew
backfill/export workload
compaction capacity
repair windows
backup cost
multi-DC replication
```

Key capacity risks:

- assignee queue fanout,
- mega tenant skew,
- event log growth,
- TTL/tombstone notifications,
- backfill compaction debt,
- large evidence metadata/payload.

---

## 31. Operations Baseline

Minimum runbooks:

```text
node down
slow node
disk high
compaction backlog
repair overdue
tombstone incident
hot partition
tenant noisy neighbor
backfill pause/resume
schema migration rollback
restore/deletion replay
multi-region failover
```

Cluster operations must coordinate with app kill switches.

---

## 32. Backup/Restore/DR

Strategy:

```text
backup source tables and critical metadata
restore source first
rebuild derived tables
replay privacy deletions
validate invariants
restore/search/object storage consistency
```

DR targets:

```text
RPO 15m for source
RTO 4h for regional restore
restore drill quarterly/monthly based on criticality
```

Tenant restore:

```text
restore to isolated cluster
extract tenant source data
transform to current schema
replay deletions
import idempotently
rebuild derived
audit
```

---

## 33. Observability

Dashboards:

```text
service SLO
repository operation
driver
cluster
table
tenant/noisy neighbor
backfill/export
repair/backup
multi-region
correctness validators
```

Metrics:

```text
latency p99 by operation
timeout_unknown
LWT conflict
retry attempts
fanout count
rows fetched/returned
source_version stale ratio
projection lag
tenant QPS
table tombstones
compaction backlog
backup age
validator violations
```

Slow logs include:

```text
operation, table, CL, profile, tenant tier, partition_key_hash, rows, pages, retries, fanout
```

No PII.

---

## 34. Security and Compliance

Controls:

```text
least privilege DB roles
separate app/migration/backfill/export credentials
TLS
secrets manager
backup encryption
tenant_id from auth
repository tenant enforcement
PII minimization
cursor signing
audit logs
privacy deletion log
legal hold
data residency routing
secure DLQ
secure restore/export
```

Rule:

```text
Every denormalized PII copy is a compliance obligation.
```

---

## 35. Migration Plan from Existing PostgreSQL

If existing platform starts in PostgreSQL:

```text
1. assess workload
2. keep PostgreSQL source initially
3. create ScyllaDB derived serving tables
4. dual-write or CDC live changes
5. backfill historical data
6. validate by tenant/status/day checksum
7. shadow read
8. cutover assignee queue per tenant
9. keep rollback for 7 days
10. later migrate event/current source if justified
```

Do not migrate reporting/search into ScyllaDB.

Use search/OLAP systems.

---

## 36. Production Readiness Review

Before launch:

```text
[ ] access patterns documented
[ ] table schemas reviewed
[ ] partition size estimates done
[ ] hot key analysis done
[ ] CL profiles defined
[ ] Java driver config reviewed
[ ] retry/idempotency tested
[ ] LWT timeout handling tested
[ ] backfill tested with crash/resume
[ ] validators implemented
[ ] dashboards live
[ ] alerts have runbooks
[ ] backup restore drill passed
[ ] security threat model reviewed
[ ] privacy deletion tested
[ ] tenant isolation tests passed
[ ] load test with skew completed
[ ] chaos test node down completed
[ ] migration rollback tested
```

---

## 37. Design Review Questions

Ask these in architecture review:

```text
1. What is the source of truth?
2. What is derived?
3. What happens on timeout?
4. What is idempotent?
5. What is the largest partition?
6. What is the hottest key?
7. What is the fanout per endpoint?
8. What is the write amplification per command?
9. What happens if derived write fails?
10. How do we reconcile?
11. How do we restore?
12. How do we delete privacy data?
13. How do we prevent cross-tenant access?
14. How do we rollback migration?
15. What dashboard proves health?
```

---

## 38. Example End-to-End Failure Walkthrough

Scenario:

```text
user transitions case from UNDER_REVIEW to APPROVED
LWT update succeeds
response times out
event insert maybe not completed
client retries with same command_id
```

Correct handling:

```text
1. retry reserves command_id -> existing RESERVED/PENDING
2. service reads current case
3. sees last_command_id/last_event_id matches command
4. inserts/retries missing event if necessary
5. stores APPLIED result
6. returns APPLIED with version
7. projection worker updates views idempotently
8. validator later checks event/current consistency
```

Bad handling:

```text
client generates new command_id
service repeats transition
duplicate audit/event or conflict confusion
```

---

## 39. Example Backfill Walkthrough

Need new queue table v2.

```text
1. CREATE TABLE v2
2. deploy projector dual-writing v1/v2
3. backfill current OPEN cases to v2
4. checkpoint by tenant/day/bucket
5. source_version included
6. shadow read compares v1/v2
7. cutover small tenants
8. cutover medium
9. mega tenants with dedicated throttle
10. monitor mismatch/fallback
11. stop v1 writes after rollback window
12. drop v1 later
```

---

## 40. Example Restore Walkthrough

Accidental delete for tenant.

```text
1. freeze further destructive jobs
2. identify restore point
3. restore backup to isolated cluster
4. extract tenant source data
5. replay privacy deletions after restore point
6. transform to current schema
7. import with idempotent command/domain operation
8. rebuild derived views/search
9. validate counts/invariants
10. audit restore
11. resume tenant
```

Never raw-merge old SSTables into live shared cluster casually.

---

## 41. What Not to Put in ScyllaDB

Avoid using ScyllaDB for:

```text
arbitrary admin analytics
full text search
large binary evidence
unbounded cross-tenant scans
ad-hoc custom-field filtering
global counters requiring exactness at high volume
complex relational constraints
multi-row transactional workflows without redesign
```

Use right tool:

```text
search engine
object storage
OLAP database
PostgreSQL
Kafka/event stream
cache
```

Top 1% engineering is choosing boundaries.

---

## 42. Core Mental Models Recap

### Query-First

```text
table is built for query shape
```

### Partition Discipline

```text
bounded partition, bounded fanout
```

### Source vs Derived

```text
source protected, derived reconciled
```

### Timeout Ambiguity

```text
write timeout outcome unknown
```

### Idempotency

```text
retry same command, same result
```

### Operational Headroom

```text
capacity includes compaction/failure/backfill
```

### Observability

```text
operation -> table -> tenant -> node/shard
```

### Security

```text
tenant scope and PII handling built into schema/code
```

---

## 43. Final Engineering Checklist

```text
[ ] I can explain every table's access pattern.
[ ] I can estimate every partition's max rows/bytes.
[ ] I can explain every command's write amplification.
[ ] I can explain every endpoint's read fanout.
[ ] I know which tables are source and which are derived.
[ ] I know what happens on read timeout.
[ ] I know what happens on write timeout.
[ ] I know which retries are safe.
[ ] I know how LWT conflict and timeout are handled.
[ ] I know how derived tables are reconciled.
[ ] I know how backfill is throttled and resumed.
[ ] I know how schema evolves safely.
[ ] I know how tenant isolation is enforced.
[ ] I know how data is restored without resurrecting deletions.
[ ] I know which dashboards prove SLO.
[ ] I know the runbooks for common incidents.
```

---

## 44. How to Continue Learning After This Series

Next learning directions:

```text
1. Run ScyllaDB locally and implement the capstone schema.
2. Build Java repositories with prepared statements and execution profiles.
3. Write load tests for point read, queue read, transition LWT, event append.
4. Simulate timeout and retry behavior.
5. Build a projection worker with idempotent writes.
6. Build a backfill job with checkpoint/DLQ/throttle.
7. Create dashboards from repository metrics.
8. Run chaos tests: node restart, slow query, backfill overload.
9. Practice schema evolution v1 -> v2.
10. Practice restore into isolated cluster and rebuild derived views.
```

Knowledge becomes skill only when exercised.

---

## 45. Final Summary

A production-grade ScyllaDB system is not “NoSQL table + Java driver”.

It is a carefully designed distributed OLTP system.

You need:

- query-first physical data model,
- bounded partitions,
- controlled consistency,
- idempotent writes,
- explicit source/derived separation,
- safe schema evolution,
- backfill/reconciliation machinery,
- tenant isolation,
- multi-region ownership,
- operations headroom,
- repair/backup/restore discipline,
- observability from API to shard,
- security/compliance built into data lifecycle,
- migration/cutover/rollback plans.

ScyllaDB can give excellent performance and scalability when the workload is designed for it.

But it rewards engineers who are explicit about:

```text
access pattern
failure mode
correctness boundary
operational cost
data lifecycle
```

That is the difference between “using ScyllaDB” and engineering a ScyllaDB-backed system well.

---

## 46. Series Completion

This is the final part of:

```text
learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers
```

Parts completed:

```text
000 through 034
```

At this point, you have a complete internal-handbook-style foundation for:

```text
OLTP wide-column database design
ScyllaDB architecture
CQL/data modeling
Java client engineering
correctness
operations
security
migration
production readiness
```

---

# End of Part 034
# End of Series


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Migration and Interoperability: Cassandra/PostgreSQL/MongoDB Migration, Dual-Write, CDC, Data Validation, Cutover, Rollback, Compatibility, dan Ecosystem Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>

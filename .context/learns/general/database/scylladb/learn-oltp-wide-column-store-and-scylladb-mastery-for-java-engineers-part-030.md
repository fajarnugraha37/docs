# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-030.md

# Part 030 — Failure Modelling: Partial Failures, Timeouts, Unknown Outcomes, Network Partitions, Slow Replicas, Retry Storms, Split-Brain, Data Corruption, Operator Errors, dan Graceful Degradation

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `030`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: membangun failure model untuk ScyllaDB-backed systems: partial failures, timeout ambiguity, read/write/LWT unknown outcomes, node failures, slow replicas, network partitions, retry storms, split-brain, data corruption, bad deploy, operator errors, backfill incidents, and designing graceful degradation.

---

## 0. Posisi Part Ini dalam Seri

Part 029 membahas observability.

Part ini membahas sesuatu yang lebih fundamental:

```text
Apa saja cara sistem ini bisa gagal?
Apa yang aplikasi harus lakukan saat gagal?
Apa failure yang aman di-retry?
Apa failure yang outcome-nya unknown?
Apa failure yang harus degrade?
Apa failure yang butuh operator?
Apa failure yang harus dicegah secara desain?
```

Distributed database tidak gagal seperti single-process library.

ScyllaDB-backed Java service berada di tengah banyak failure domain:

```text
client process
driver
network
coordinator
replica
shard
disk
compaction
repair
schema
multi-DC link
application logic
operator actions
external systems
```

Top-tier engineer tidak hanya tahu happy path.

Ia punya failure model.

---

## 1. Failure Modelling Mental Model

Failure modelling adalah proses eksplisit untuk menjawab:

```text
1. What can fail?
2. How does it fail?
3. What does the caller observe?
4. What actually happened to data?
5. Can we retry?
6. Can we know outcome?
7. What invariant is at risk?
8. How do we recover?
9. How do we detect it?
10. How do we test it?
```

Tanpa failure model, retry policy dan error handling biasanya salah.

---

## 2. Distributed Systems Failure Reality

Dalam distributed systems:

```text
request can succeed but response lost
request can fail before reaching server
request can reach coordinator but not replicas
some replicas can apply write, others not
client can timeout while server continues
network can partition asymmetrically
node can be slow but not dead
clock can skew
operator can restore old data
```

Therefore:

```text
"exception thrown" does not always mean "operation did not happen"
```

This is the most important mental model for writes.

---

## 3. Failure Domains

### 3.1 Client/App

- GC pause,
- thread pool saturation,
- async queue overflow,
- bad retry policy,
- bad deploy,
- wrong local DC config.

### 3.2 Driver

- connection pool saturation,
- stale metadata,
- node marked down/up,
- request timeout,
- retry/speculative behavior.

### 3.3 Network

- packet loss,
- latency spike,
- one-way partition,
- DNS issue,
- load balancer issue.

### 3.4 Coordinator

- overload,
- crash mid-request,
- slow shard,
- node restart.

### 3.5 Replica

- down,
- slow,
- disk issue,
- compaction pressure,
- stale data.

### 3.6 Storage

- disk full,
- corrupted SSTable,
- compaction backlog,
- tombstone storm.

### 3.7 Operations

- wrong schema migration,
- bad restore,
- accidental delete,
- backfill runaway,
- repair skipped.

---

## 4. Failure Taxonomy

Classify failures:

```text
1. transient
2. persistent
3. partial
4. ambiguous outcome
5. correctness-threatening
6. performance-degrading
7. operator-induced
8. security/compliance
```

Examples:

| Failure | Category |
|---|---|
| read timeout | transient/partial |
| write timeout | ambiguous outcome |
| LWT timeout | ambiguous outcome |
| unavailable | availability/failure |
| overloaded | saturation |
| invalid query | bug |
| schema mismatch | deploy/migration |
| node slow | performance/partial |
| network partition | distributed consistency |
| bad backfill | operator/application |
| restore old data | correctness/privacy |

---

## 5. Timeout Ambiguity

Timeout means:

```text
client did not receive response before deadline
```

It does not necessarily mean:

```text
operation failed
```

Possibilities:

```text
1. request never left client
2. request reached coordinator but not replicas
3. some replicas applied
4. quorum applied but response lost
5. coordinator still processing after client timed out
6. operation eventually succeeds
```

For reads, timeout means:

```text
no result known
```

For writes, timeout means:

```text
outcome unknown
```

This difference drives error handling.

---

## 6. Read Timeout

Read timeout:

```text
SELECT by key timed out
```

Possible actions:

- retry if within deadline,
- read from fallback/cache if stale acceptable,
- return 503/504,
- degrade UI component,
- log operation/table/key hash.

Read timeout does not usually corrupt data.

But repeated read timeout indicates:

- hot key,
- large partition,
- tombstones,
- slow replica,
- CL too high for current condition,
- client overload.

---

## 7. Write Timeout

Write timeout is more dangerous.

Example:

```sql
INSERT INTO case_events_by_case_version_bucket (...)
VALUES (...);
```

If timeout occurs:

```text
event may exist
event may not exist
event may exist on some replicas
```

If primary key deterministic and write idempotent:

```text
retry same write is usually safe
```

If write is non-idempotent:

```text
retry can duplicate/corrupt
```

Therefore all write APIs need idempotency classification.

---

## 8. LWT Timeout

LWT timeout:

```sql
UPDATE ... IF version = ?
```

Outcome unknown:

- condition may not have been met,
- condition met and write applied,
- proposal in progress,
- response lost,
- later read may reveal outcome.

Correct handling:

```text
read current state
compare expected result / command_id / version
decide success/conflict/pending
```

Do not blindly retry as if no change happened.

---

## 9. Counter Timeout

Counter increment timeout:

```sql
views = views + 1
```

Worst case:

```text
retry increments twice
```

Counter operations are not naturally idempotent.

If exactness matters, counters are wrong primitive.

Failure model should label counter increment as:

```text
non-idempotent ambiguous write
```

---

## 10. List Append Timeout

List append:

```sql
comments = comments + ['x']
```

Timeout + retry can duplicate.

Use child table with stable `comment_id`.

This is why data modeling affects failure recovery.

---

## 11. Idempotent Write Pattern

Idempotent write means:

```text
same command retried -> same final state
```

Example:

```sql
INSERT INTO case_events_by_case_version_bucket (
    tenant_id,
    case_id,
    version_bucket,
    event_version,
    event_id,
    ...
) VALUES (?, ?, ?, ?, ?, ...);
```

Where:

```text
event_id generated once per command
event_version stable
primary key deterministic
```

Retry same statement is safe-ish.

---

## 12. Command Idempotency Table

For external API commands:

```sql
CREATE TABLE command_result_by_id (
    tenant_id uuid,
    command_id uuid,
    status text,
    result_payload text,
    created_at timestamp,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, command_id))
);
```

Flow:

```text
1. client sends command_id
2. service reserves command_id
3. performs work idempotently
4. stores result
5. retry returns same result
```

This converts ambiguous client retry into deterministic behavior.

---

## 13. Unknown Outcome as Domain State

Sometimes honest response is:

```text
PENDING / UNKNOWN
```

Example API:

```json
{
  "status": "PENDING_CONFIRMATION",
  "commandId": "..."
}
```

Then client can poll:

```text
GET /commands/{commandId}
```

This is better than lying:

```text
failed
```

when command might have succeeded.

---

## 14. Partial Write Across Tables

Command writes:

```text
event table
current table
derived table
idempotency table
```

Failure after some writes:

```text
partial state
```

Mitigation:

- source-of-truth first,
- derived tables async/rebuildable,
- command result state,
- reconciliation,
- idempotent retry,
- LWT for critical state,
- avoid assuming multi-table atomicity.

---

## 15. Source-of-Truth First Pattern

For complex command:

```text
1. validate command
2. write source event/current state atomically enough
3. emit/rebuild derived views
```

Derived write failure should not corrupt source.

If derived view missing row:

```text
reconciliation can repair
```

If source write missing but derived present:

```text
derived is orphan and should be removed
```

Authority matrix matters.

---

## 16. Failure Matrix by Operation Type

| Operation | Failure Concern | Safe Strategy |
|---|---|---|
| point read | timeout/stale | retry/cache/degrade |
| source insert idempotent | unknown | retry same key/read-after |
| counter increment | duplicate | avoid or accept approximate |
| LWT transition | unknown/conflict | read-after-timeout |
| derived write | partial | async retry/reconcile |
| batch/backfill | duplicates | idempotent + checkpoint |
| delete/privacy | resurrection | deletion log + repair |
| export | partial output | checkpoint + manifest |

---

## 17. Node Down

If one node down with RF=3 LOCAL_QUORUM:

```text
reads/writes may continue
```

But:

- latency can rise,
- capacity reduced,
- repair/hints later,
- failure tolerance reduced,
- some CL=ALL fails,
- hot partitions on remaining replicas worse.

Application behavior:

- no retry storm,
- pause backfills,
- monitor p99,
- respect SLO.

---

## 18. Node Slow

Slow node is more insidious.

It may still receive traffic and respond late.

Effects:

- p99 increases,
- coordinator waits,
- timeouts,
- retries,
- speculative execution extra load.

Mitigation:

- detect slow node,
- DB ops isolate/restart/replace,
- client timeouts reasonable,
- avoid aggressive retries.

---

## 19. Coordinator Failure Mid-Request

Coordinator can fail after forwarding write to replicas.

Client sees error/timeout.

Data may have been applied.

For idempotent writes, retry same operation.

For non-idempotent, resolve via read/idempotency table/domain state.

---

## 20. Replica Failure Mid-Write

Some replicas apply, some do not.

CL determines whether client sees success.

Later repair/hints converge.

If write fails to meet CL:

```text
client sees failure/timeout
but some replicas may have mutation
```

Again: outcome may be partial.

---

## 21. Network Partition

Network partition can split client/coordinator/replicas/DCs.

Effects:

- unavailable at high CL,
- LOCAL operations continue,
- remote DC lag,
- active-active conflicts,
- split-brain risk.

Application must know:

```text
should we continue writes locally?
should we reject non-home writes?
should we degrade reads?
```

This is architecture-specific.

---

## 22. Multi-DC Partition

WAN partition:

```text
dc_jakarta cannot reach dc_singapore
```

If using LOCAL_QUORUM:

```text
local writes may continue
```

If using EACH_QUORUM/global QUORUM:

```text
writes may fail
```

If both DCs accept writes for same entity:

```text
conflict risk
```

Home-region/fencing avoids split-brain.

---

## 23. Split-Brain

Split-brain:

```text
two regions/nodes/components both believe they are primary writer
```

In ScyllaDB active-active at LOCAL_QUORUM, same row can be updated independently.

Resolution may be LWW, not business-safe.

Prevent with:

- single writer/home region,
- fencing token/epoch,
- operator-controlled failover,
- command routing,
- conflict workflow.

---

## 24. Clock Skew

Clock skew impacts:

- write timestamps,
- TTL expiry,
- LWW,
- logs/traces,
- audit ordering if wall clock used.

Use domain version/event sequence for business ordering.

Do not rely solely on wall-clock `updated_at`.

---

## 25. Disk Full Failure

Disk full can cause severe database instability.

Application sees:

- write timeouts,
- unavailable,
- overload,
- p99 spike.

Immediate app mitigation:

- pause backfills/exports,
- reduce writes if possible,
- shed non-critical traffic,
- avoid retry storm.

Permanent fix:

- capacity/retention/compaction/data model.

---

## 26. Compaction Backlog Failure

Compaction backlog may cause:

- read amplification,
- disk growth,
- tombstones not purged,
- p99 spikes.

App causes:

- huge backfill,
- TTL surge,
- large payload,
- many derived writes.

Mitigation:

- throttle heavy jobs,
- reduce write amplification,
- ops tuning/capacity.

---

## 27. Tombstone Storm

Tombstone storm from:

- queue delete pattern,
- TTL-heavy reads,
- collection overwrites,
- large range deletes,
- stale derived cleanup.

Failure:

- read timeout,
- p99 spike,
- compaction pressure.

Fix usually requires data model/lifecycle change.

---

## 28. Bad Schema Migration

Failures:

- app prepares query against missing table/column,
- old app reads new enum and crashes,
- drop column while old app running,
- schema disagreement,
- wrong compaction/TTL option.

Mitigation:

- expand/migrate/contract,
- schema agreement wait,
- feature flags,
- compatibility tests,
- rollback plan.

---

## 29. Bad Backfill

Backfill failures:

- overload cluster,
- write wrong rows,
- overwrite newer data,
- generate duplicates,
- create tombstones,
- fill disk,
- violate tenant fairness.

Mitigation:

- kill switch,
- throttle,
- checkpoint,
- DLQ,
- validation,
- source_version,
- canary tenant.

---

## 30. Bad Restore

Restore can:

- resurrect deleted data,
- restore stale derived rows,
- mismatch schema,
- break external object references,
- violate privacy deletion,
- create old enum/payload incompatibility.

Mitigation:

- restore to isolated cluster,
- deletion replay,
- source-first restore,
- rebuild derived,
- validation,
- domain-aware import.

---

## 31. Data Corruption

Possible forms:

- storage corruption,
- application writes invalid payload,
- serialization bug,
- bad migration transform,
- external system mismatch,
- operator overwrites data.

Detection:

- checksums,
- validation jobs,
- invariant checks,
- shadow reads,
- restore drills,
- audit logs.

Recovery:

- restore source,
- replay events,
- correction events,
- rebuild derived,
- tenant/case-level repair.

---

## 32. Operator Error

Examples:

- wrong keyspace dropped,
- wrong table truncated,
- backfill run on prod with dev config,
- wrong local DC config deployed,
- repair/cleanup wrong target,
- schema migration applied twice,
- backup retention deleted.

Mitigation:

- automation,
- approvals,
- dry run,
- least privilege,
- runbooks,
- canary,
- immutable backups,
- audit logs.

---

## 33. Security Incident Failure Model

Security issue can affect database:

- credential leak,
- unauthorized export,
- malicious delete,
- backup access,
- PII in logs,
- tenant isolation bypass.

Failure response includes:

- revoke credentials,
- audit access,
- rotate keys,
- restore if destructive,
- notify per policy,
- verify tenant isolation.

Security and reliability overlap.

---

## 34. External Dependency Failure

ScyllaDB app often depends on:

- Kafka,
- object storage,
- search,
- auth,
- KMS,
- cache,
- payment system.

If Scylla write succeeds but external publish fails:

```text
projection missing
```

If external side effect succeeds but Scylla command times out:

```text
duplicate side effect risk
```

Use outbox/idempotency/reconciliation.

---

## 35. Graceful Degradation

Not all failures require total outage.

Degrade:

- serve cached/stale derived read,
- disable exports,
- pause backfill,
- reduce page size,
- hide non-critical widgets,
- return partial feed if allowed,
- queue commands,
- return `PENDING`,
- rate limit noisy tenant.

Do not degrade source-of-truth command correctness silently.

---

## 36. Degradation Matrix

| Feature | Degrade Option | Notes |
|---|---|---|
| case detail current state | maybe no degrade | authoritative |
| event history | show latest cached page | if acceptable |
| assignee queue | stale view with banner | product decision |
| exports | pause/disable | low priority |
| search | fallback exact lookup | limited |
| notification badge | approximate/stale | acceptable often |
| state transition | queue/pending | correctness preserved |
| reporting | async delay | acceptable |

---

## 37. Bulkhead Pattern

Bulkhead isolates failures.

Examples:

- separate thread pool for exports,
- separate rate limit for backfill,
- per-tenant in-flight limit,
- separate execution profiles,
- separate clusters/keyspaces for mega tenants,
- separate search/reporting system.

Goal:

```text
one failing workload does not sink all workloads
```

---

## 38. Circuit Breaker

Circuit breaker stops sending requests to failing dependency/operation.

Use carefully.

For ScyllaDB:

- per operation/table maybe,
- not global unless cluster unavailable,
- combine with fallback/degradation,
- avoid flapping.

Circuit breaker without fallback may just fail fast; still useful under overload.

---

## 39. Load Shedding

When overloaded:

```text
reject early
```

Examples:

- 429 tenant quota,
- 503 non-critical endpoint,
- pause consumer,
- reject new export,
- drop refresh request.

Better than accepting work that times out and retries.

---

## 40. Retry Budget

Retry budget limits retries relative to original traffic.

Example:

```text
retries <= 10% of successful traffic
```

If errors spike, retries do not explode.

Retry budget prevents cascading failure.

---

## 41. Failure Testing

Test failure model.

Types:

- unit tests for error mapping,
- integration tests with real Scylla,
- timeout injection,
- chaos tests,
- load tests with node failure,
- backfill crash/resume,
- schema compatibility tests,
- restore drills.

If not tested, failure handling is wishful thinking.

---

## 42. Unit Tests

Test:

```text
read timeout -> retry/503
write timeout idempotent -> retry same key
write timeout non-idempotent -> pending/read-after
LWT applied=false -> conflict
LWT timeout -> read-after
counter timeout -> no blind retry
codec error -> bug alert
invalid query -> bug alert
```

---

## 43. Integration Tests

With real DB:

- prepared statements,
- CL behavior,
- LWT result,
- timeout via fault injection if possible,
- paging,
- tombstone-heavy query in controlled test,
- schema migration compatibility.

Mocks cannot fully model distributed outcomes.

---

## 44. Chaos Tests

Scenarios:

```text
kill node
slow node
network partition
disk pressure
restart during writes
pause projector
kill app after source write before derived write
backfill crash before checkpoint
restore old backup to test cluster
wrong enum value in row
```

Verify invariants.

---

## 45. Invariant Testing

Define invariants:

```text
case version monotonically increases
event log has no duplicate event_id
current.version equals latest applied event
open_cases view eventually matches current state
privacy-deleted subject absent after deletion replay
command_id returns same result on retry
```

Run validators.

Observability should alert on invariant violation.

---

## 46. Failure Injection in Java

Inject:

- repository timeout,
- driver exception categories,
- partial derived write failure,
- command result write failure,
- stale read,
- duplicate command,
- slow future,
- cancellation.

This improves service resilience independent of cluster test.

---

## 47. Designing APIs for Failure

APIs should expose honest states.

Command response:

```json
{
  "commandId": "...",
  "status": "APPLIED"
}
```

or:

```json
{
  "commandId": "...",
  "status": "PENDING_CONFIRMATION"
}
```

or:

```json
{
  "commandId": "...",
  "status": "CONFLICT",
  "currentVersion": 9
}
```

Avoid ambiguous:

```json
{"success": false}
```

for unknown write outcome.

---

## 48. Client Contract

External clients should know:

- use idempotency key,
- retry safe errors with same key,
- poll command status for pending,
- do not resubmit random command,
- handle 409 conflict,
- handle 429 quota,
- handle 503 retry-after.

Reliability is end-to-end.

---

## 49. Operational Controls

For failure response, operators need:

- pause backfill,
- throttle tenant,
- disable export,
- switch read flag,
- force home-region writes only,
- disable speculative execution profile,
- reduce page size,
- enable degraded mode,
- kill bad job.

Controls must be tested.

---

## 50. Failure Mode and Effects Analysis

FMEA table columns:

```text
failure mode
cause
user impact
data impact
detection
immediate mitigation
long-term fix
test coverage
owner
```

Use FMEA for critical workflows.

---

## 51. Example FMEA: Case Transition

| Field | Content |
|---|---|
| Failure | LWT timeout |
| User Impact | command pending/slow |
| Data Impact | unknown current state |
| Detection | timeout_unknown metric |
| Mitigation | read-after-timeout by command/version |
| Long-Term | reduce contention/per-key queue |
| Test | injected timeout |
| Owner | case service |

---

## 52. Example FMEA: Assignee Queue

| Field | Content |
|---|---|
| Failure | derived write missed |
| User Impact | case missing from queue |
| Data Impact | source correct, view stale |
| Detection | shadow validation/reconciliation |
| Mitigation | read fallback/reconcile |
| Long-Term | projector idempotency/source_version |
| Test | kill projector after source write |
| Owner | workflow platform |

---

## 53. Example FMEA: Tenant Backfill

| Field | Content |
|---|---|
| Failure | backfill overwrites newer derived row |
| User Impact | stale queue |
| Data Impact | derived stale |
| Detection | source_version mismatch |
| Mitigation | pause job/reconcile |
| Long-Term | version-aware write/replay |
| Test | live write race test |
| Owner | migration team |

---

## 54. Example FMEA: Privacy Delete

| Field | Content |
|---|---|
| Failure | restore resurrects deleted data |
| User Impact | compliance breach |
| Data Impact | deleted data reappears |
| Detection | deletion replay validator |
| Mitigation | replay deletion log/quarantine restore |
| Long-Term | restore runbook + cryptographic erasure |
| Test | restore old backup drill |
| Owner | platform/security |

---

## 55. Common Anti-Patterns

### 55.1 Treat Timeout as Failure

Wrong for writes.

### 55.2 Retry Non-Idempotent Writes

Duplicates/corruption.

### 55.3 No Command ID

Cannot resolve duplicate/unknown command.

### 55.4 Derived Table Treated as Source

Stale view becomes truth.

### 55.5 Active-Active Without Conflict Model

Split-brain.

### 55.6 No Backpressure

Failure amplifies.

### 55.7 No Degraded Mode

Small dependency failure becomes full outage.

### 55.8 No Failure Tests

Error handling unproven.

### 55.9 Restore Without Deletion Replay

Privacy breach.

### 55.10 Operator Controls Untested

Incident response fails.

---

## 56. Failure Modelling Checklist

```text
[ ] Every repository operation has idempotency classification.
[ ] Write timeout outcome handling defined.
[ ] LWT timeout read-after path implemented.
[ ] Non-idempotent operations avoid blind retry.
[ ] Command idempotency keys used for external APIs.
[ ] Derived tables have reconciliation plan.
[ ] Backfills have checkpoint/idempotency/DLQ.
[ ] Multi-region writes have home/fencing model.
[ ] Degraded modes defined.
[ ] Retry budget/backpressure implemented.
[ ] Operator kill switches tested.
[ ] Failure injection tests exist.
[ ] Invariant validators exist.
[ ] Restore/deletion replay tested.
[ ] FMEA exists for critical workflows.
```

---

## 57. Mental Model Compression

Remember:

```text
Timeout tells you what client observed,
not what database did.
```

And:

```text
Correct retries require idempotency.
Correct failover requires ownership/fencing.
Correct restore requires deletion replay.
Correct degradation requires knowing what can be stale.
```

Failure modelling is where correctness and operations meet.

---

## 58. Summary

Failure modelling turns distributed uncertainty into explicit design.

Key lessons:

1. Distributed failures are partial and ambiguous.
2. Timeout does not mean operation failed.
3. Write/LWT timeout can have unknown outcome.
4. Reads can usually retry more safely than writes.
5. Counter/list append retries can corrupt semantics.
6. Idempotent primary keys and command IDs make retries safe.
7. Partial multi-table writes require source/derived authority design.
8. Node slow can be worse than node down.
9. Network partitions require explicit local/global semantics.
10. Active-active writes need conflict model.
11. Bad schema/backfill/restore are major failure modes.
12. Graceful degradation protects user experience and cluster health.
13. Bulkheads, circuit breakers, load shedding, and retry budgets reduce blast radius.
14. Failure handling must be tested through injection/chaos.
15. Critical workflows need FMEA and invariants.
16. APIs should expose pending/conflict/unknown states honestly.

---

## 59. Review Questions

1. Kenapa timeout bukan berarti operasi gagal?
2. Apa perbedaan read timeout dan write timeout?
3. Bagaimana menangani LWT timeout?
4. Kenapa counter timeout berbahaya?
5. Apa itu idempotent write?
6. Bagaimana command_id membantu retry?
7. Apa risiko partial write across tables?
8. Kenapa derived table tidak boleh jadi source of truth?
9. Kenapa slow node berbahaya?
10. Apa itu split-brain?
11. Bagaimana home region/fencing mencegah split-brain?
12. Apa failure mode dari bad backfill?
13. Apa failure mode dari bad restore?
14. Apa itu graceful degradation?
15. Apa beda bulkhead dan circuit breaker?
16. Apa itu retry budget?
17. Apa invariant penting untuk case workflow?
18. Apa saja chaos test yang berguna?
19. Apa itu FMEA?
20. Apa checklist failure modelling?

---

## 60. Practical Exercise

Buat FMEA untuk regulatory case platform untuk workflow:

```text
POST /cases/{caseId}/transition
```

yang melakukan:

```text
1. command idempotency check
2. LWT update case_current_by_id
3. insert case event
4. update open_cases_by_assignee derived table
5. publish notification event
```

Isi FMEA untuk failure:

```text
- duplicate client retry
- LWT timeout
- LWT conflict
- event insert timeout
- derived write failure
- notification publish failure
- node slow
- network partition
- bad deploy writes wrong status
- restore resurrects old current row
```

Untuk tiap failure, tulis:

```text
user impact
data impact
detection metric/log
safe retry?
mitigation
reconciliation
long-term fix
test case
```

---

## 61. Preview Part 031

Part berikutnya membahas:

```text
Correctness Patterns:
idempotency,
deduplication,
sagas,
outbox,
event sourcing,
versioned state machines,
single-writer patterns,
reconciliation,
read-your-write,
and domain invariants.
```

Part 030 membangun failure model.

Part 031 akan membahas pattern correctness untuk membuat sistem tetap benar meskipun failure terjadi.

---

# End of Part 030


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Observability: Metrics, Logs, Tracing, Dashboards, Alerts, SLOs, Driver Metrics, Table/Tenant-Level Monitoring, dan p99 Incident Diagnosis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-031.md">Part 031 — Correctness Patterns: Idempotency, Deduplication, Sagas, Outbox, Event Sourcing, Versioned State Machines, Single-Writer, Reconciliation, Read-Your-Write, dan Domain Invariants ➡️</a>
</div>

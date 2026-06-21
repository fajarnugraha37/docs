# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-013.md

# Part 013 — Consistency Levels: ONE, QUORUM, LOCAL_QUORUM, ALL, SERIAL, dan Trade-off Praktis

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `013`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami consistency level secara praktis: replication factor, quorum math, read/write CL combinations, LOCAL_QUORUM, multi-DC, stale reads, read-your-write, availability trade-off, timeout ambiguity, LWT serial consistency, dan Java driver configuration.

---

## 0. Posisi Part Ini dalam Seri

Di part 012 kita membahas multi-access-pattern design:

```text
source-of-truth
derived views
write fanout
projection
reconciliation
backfill
```

Part ini menjawab pertanyaan yang muncul setelah kita punya banyak table:

> Untuk tiap operasi read/write, consistency level apa yang harus dipakai?

Consistency level bukan setting global yang dipilih sekali.

Consistency level adalah bagian dari kontrak operasi.

Contoh:

```text
append audit event             -> LOCAL_QUORUM
read current case state        -> LOCAL_QUORUM
read notification feed         -> LOCAL_ONE mungkin cukup
write derived assignee view    -> LOCAL_ONE atau LOCAL_QUORUM tergantung semantics
insert idempotency key         -> LWT + LOCAL_SERIAL/SERIAL + LOCAL_QUORUM
read dashboard aggregate       -> LOCAL_ONE mungkin cukup
```

Tujuan part ini:

```text
membuat kamu bisa memilih CL berdasarkan correctness, freshness, latency, availability, dan cost.
```

Bukan sekadar hafal enum.

---

## 1. Apa Itu Consistency Level?

Consistency level menentukan berapa banyak replica yang harus merespons atau mengakui operasi sebelum coordinator mengembalikan hasil ke client.

Dalam ScyllaDB/Cassandra-style systems:

```text
replication factor = jumlah target copy data
consistency level = jumlah/scope response yang dibutuhkan per operasi
```

Contoh:

```text
RF = 3
replica set = A, B, C
```

Write CL=QUORUM:

```text
coordinator menunggu 2 replica ack
```

Read CL=ONE:

```text
coordinator cukup membaca dari 1 replica
```

ScyllaDB documentation states that consistency level determines how many replicas in a cluster must acknowledge read or write operations before they are considered successful. Apache Cassandra/CQL documentation describes the same concept: consistency level determines how many replica nodes must respond for the coordinator to process a non-lightweight transaction successfully.

---

## 2. RF and CL Are Different

Replication factor:

```text
How many replicas should store the data?
```

Consistency level:

```text
How many replicas must respond now?
```

Example:

```text
RF = 3
CL = ONE
```

Means:

```text
data should have 3 replicas eventually/target
operation succeeds after 1 replica response
```

This can be correct for some workloads, but not all.

Common mistake:

```text
RF=3 means write success reached 3 replicas.
```

Wrong. Write success depends on CL.

---

## 3. Quorum Math

Quorum for RF=N:

```text
QUORUM = floor(N / 2) + 1
```

Examples:

| RF | Quorum |
|---:|---:|
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |
| 6 | 4 |

Most common:

```text
RF=3 -> QUORUM=2
```

Why quorum matters:

```text
read quorum and write quorum overlap
```

If:

```text
W + R > RF
```

then every read set and write set overlap at least one replica.

For RF=3:

```text
W=2, R=2
W+R=4 > 3
```

So write QUORUM + read QUORUM has overlap.

---

## 4. Quorum Overlap Example

Replica set:

```text
A, B, C
```

Write CL=QUORUM:

```text
write reaches/acks A and B
```

Read CL=QUORUM:

```text
read gets B and C
```

Overlap:

```text
B
```

The read sees at least one replica that acknowledged the write, assuming normal timestamp/reconciliation semantics.

This is the basis for stronger freshness than CL ONE.

But quorum overlap is not SQL serializable transaction.

It does not automatically solve:

- multi-row transaction,
- multi-partition invariant,
- uniqueness,
- concurrent lost update,
- business state transition race,
- external side effect exactly-once.

---

## 5. Common Consistency Levels

ScyllaDB supports Cassandra-compatible consistency levels. Important ones:

| CL | Meaning |
|---|---|
| ANY | write can succeed if mutation stored as hint; write only |
| ONE | one replica must respond |
| TWO | two replicas must respond |
| THREE | three replicas must respond |
| QUORUM | majority of replicas |
| ALL | all replicas |
| LOCAL_ONE | one replica in local DC |
| LOCAL_QUORUM | majority of replicas in local DC |
| EACH_QUORUM | quorum in each DC, write only |
| SERIAL | serial consistency for LWT across relevant replicas |
| LOCAL_SERIAL | local serial consistency for LWT in local DC |

Not every CL is appropriate for every operation.

---

## 6. CL ONE

Write CL ONE:

```text
success after one replica ack
```

Read CL ONE:

```text
return after one replica response
```

### 6.1 Pros

- low latency,
- high availability,
- tolerates more replica failure,
- good for stale-tolerant derived/read models,
- useful for non-critical telemetry/feed reads.

### 6.2 Cons

- stale reads possible,
- read-your-write not guaranteed if subsequent read hits different replica,
- lower durability acknowledgement on write,
- more reliance on hints/repair for convergence,
- not suitable for strict correctness source writes unless consciously accepted.

### 6.3 Good Use Cases

```text
notification feed read where stale okay
dashboard aggregate read
cache-like derived view
telemetry write if data loss/staleness acceptable
non-critical status badge
```

### 6.4 Bad Use Cases

```text
payment capture state
case lifecycle authoritative state
idempotency guard
unique reservation
regulatory audit event if durability important
authorization state
```

---

## 7. CL LOCAL_ONE

LOCAL_ONE is like ONE but restricted to local datacenter.

Use in multi-DC systems where you want:

```text
low latency local reads/writes
avoid cross-region round trip
```

Good for:

- local derived views,
- feeds,
- read-mostly stale-tolerant workloads,
- local telemetry.

Risk:

```text
stale relative to remote writes
```

If same entity can be written in another DC, LOCAL_ONE can easily read stale data.

---

## 8. CL QUORUM

QUORUM means majority of all replicas for the keyspace/replication scope.

In single-DC RF=3:

```text
QUORUM = 2
```

Good balance:

- stronger freshness than ONE,
- tolerates one replica down,
- common for authoritative source/current operations.

### 8.1 Pros

- read/write quorum overlap,
- improved read-your-write behavior if both use QUORUM,
- good durability acknowledgement,
- still available with one failed replica for RF=3.

### 8.2 Cons

- higher latency than ONE,
- lower availability than ONE,
- can involve remote DC if used globally in multi-DC,
- not full transactional isolation.

In multi-DC, prefer LOCAL_QUORUM unless global semantics intended.

---

## 9. CL LOCAL_QUORUM

LOCAL_QUORUM means quorum among replicas in local datacenter.

Example:

```text
NetworkTopologyStrategy:
dc_jakarta: RF=3
dc_singapore: RF=3
```

LOCAL_QUORUM in Jakarta:

```text
wait for 2 of 3 Jakarta replicas
```

It does not wait for Singapore replicas.

### 9.1 Why LOCAL_QUORUM Is Common

- avoids cross-region latency,
- strong-ish within local DC,
- works well with NetworkTopologyStrategy,
- preserves local availability when remote DC slow/down,
- common production default for authoritative operations in multi-DC.

ScyllaDB docs list LOCAL_QUORUM as quorum confined to the local datacenter; DataStax/Cassandra documentation similarly recommends LOCAL_QUORUM for multi-datacenter clusters to avoid inter-datacenter latency while maintaining local consistency.

### 9.2 LOCAL_QUORUM Caveat

If same entity is written concurrently in multiple DCs, LOCAL_QUORUM does not prevent conflict.

Example:

```text
Jakarta writes case status APPROVED at LOCAL_QUORUM
Singapore writes case status REJECTED at LOCAL_QUORUM
```

Both can succeed locally.

Conflict resolution then depends on timestamp/cell semantics unless application prevents it.

For strict entity lifecycle, prefer:

```text
single writer/home region per entity
```

or explicit conflict protocol.

---

## 10. CL ALL

ALL requires all replicas to respond.

RF=3:

```text
A, B, C all must ack/respond
```

### 10.1 Pros

- strongest acknowledgement among non-LWT CLs,
- no replica can be down/slow for success,
- useful rarely for special operations.

### 10.2 Cons

- lowest availability,
- high tail latency,
- one slow/unavailable replica fails operation,
- often too fragile for production OLTP.

CL ALL is rarely a good default.

If you think you need ALL, ask:

```text
Is the system allowed to fail writes when one replica is slow?
Is this actually a transaction/invariant problem better solved with LWT/workflow?
Is LOCAL_QUORUM enough?
```

---

## 11. CL ANY

ANY is write-only and can allow write success when even no replica is currently available if a hint can be stored.

This maximizes write availability but weakens immediate durability/read visibility semantics.

Use with extreme caution.

For most Java application engineers:

```text
avoid ANY unless you deeply understand hinted handoff and data loss/freshness implications.
```

Not suitable for critical authoritative writes.

---

## 12. EACH_QUORUM

EACH_QUORUM is write-only and requires quorum in each datacenter.

Example:

```text
dc_jakarta RF=3 -> 2 required
dc_singapore RF=3 -> 2 required
```

Write succeeds only if each DC quorum acknowledges.

Pros:

- stronger cross-DC write acknowledgement.

Cons:

- high latency,
- low availability under DC/network issues,
- cross-region dependency,
- can hurt global resilience.

Use only when requirement explicitly demands multi-DC synchronous durability and availability trade-off is acceptable.

---

## 13. SERIAL and LOCAL_SERIAL

SERIAL/LOCAL_SERIAL are used with lightweight transactions (LWT/CAS).

Examples:

```sql
INSERT INTO users_by_email (...)
VALUES (...)
IF NOT EXISTS;
```

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE tenant_id = ? AND case_id = ?
IF status = ? AND version = ?;
```

LWT has two consistency dimensions:

```text
normal consistency level
serial consistency level
```

Serial consistency affects the Paxos/conditional part.

### 13.1 SERIAL

Coordinates serial phase across relevant replicas, potentially across DCs depending topology.

### 13.2 LOCAL_SERIAL

Confines serial phase to local DC, often preferred for local low-latency LWT where semantics fit.

Deep LWT mechanics are part 014.

For now:

```text
SERIAL/LOCAL_SERIAL are not normal read/write CL.
They are for conditional transaction semantics.
```

---

## 14. Read/Write CL Combinations

Consistency is about combination.

### 14.1 Write ONE + Read ONE

```text
W=1, R=1
W+R=2 <= RF=3
```

No guaranteed overlap.

Risk:

```text
read stale after write
```

Good for:

- eventual data,
- low criticality,
- derived/cached views.

### 14.2 Write QUORUM + Read ONE

```text
W=2, R=1
W+R=3 == RF=3
```

No mathematical guaranteed overlap because need `> RF`.

But write is more durable.

Read can still hit stale replica.

Good if:

- write durability important,
- read freshness less important.

### 14.3 Write ONE + Read QUORUM

```text
W=1, R=2
W+R=3 == RF=3
```

Still no guaranteed overlap.

Read quorum can improve chance/freshness but if write only reached one replica, read quorum might read the other two.

### 14.4 Write QUORUM + Read QUORUM

```text
W=2, R=2
W+R=4 > RF=3
```

Guaranteed overlap.

Common for stronger read-your-write within one DC/scope.

### 14.5 Write ALL + Read ONE

```text
W=3, R=1
W+R=4 > RF=3
```

Overlap, but write availability poor.

Usually not worth it.

---

## 15. Strong Consistency Formula

For non-LWT quorum-style operations:

```text
R + W > RF
```

This gives overlap.

But real-world caveats:

- clock/timestamp conflict resolution,
- concurrent writes,
- read repair/reconciliation behavior,
- multi-DC local vs global scope,
- failed/timeout ambiguity,
- LWT needed for conditional invariants.

So write:

```text
quorum overlap improves freshness
```

not:

```text
quorum equals serializable transaction
```

---

## 16. Read-Your-Write

Read-your-write means after client successfully writes, subsequent read sees its write.

In ScyllaDB/Cassandra-style systems, common strategy:

```text
write LOCAL_QUORUM
read LOCAL_QUORUM
same local DC
```

This works well for many cases due to quorum overlap.

But read-your-write can fail or become ambiguous if:

- write timed out,
- read goes to different DC with LOCAL_ONE,
- write used LOCAL_ONE,
- conflict with concurrent write,
- client reads from cache,
- derived view projection lag,
- application writes one table but reads another derived table,
- LWT outcome unknown.

### 16.1 Same Table vs Derived View

If write updates source table but read checks derived table:

```text
source write success does not imply derived read sees it
```

unless derived update is synchronous and successful.

Consistency level on derived read cannot fix projection lag.

---

## 17. Monotonic Reads

Monotonic reads mean a client should not see state go backward.

Example:

```text
read status APPROVED
later read status UNDER_REVIEW
```

Possible causes:

- CL ONE reads different replicas,
- cache stale,
- multi-DC replication lag,
- derived view stale,
- last-write-wins conflict,
- clock skew.

Mitigations:

- read LOCAL_QUORUM,
- session cache/version floor,
- include version in state,
- reject older versions in client/service,
- use source/current table for decisions,
- avoid LOCAL_ONE for authoritative state.

Java service can enforce:

```text
do not return version lower than last observed for this session/entity
```

if needed.

---

## 18. Stale Reads

Stale read is not always a bug.

It depends on table semantics.

Acceptable stale examples:

- notification badge,
- search results,
- dashboard count,
- derived queue if validated on action,
- analytics rollup,
- feed display.

Unacceptable stale examples:

- idempotency guard,
- authorization decision,
- payment/capture state,
- case terminal decision,
- uniqueness reservation,
- legal audit current outcome.

Design docs should explicitly state stale tolerance.

---

## 19. Availability Trade-Off

Higher CL usually means:

```text
more replicas needed
higher latency
lower availability under failure
stronger freshness/durability
```

Lower CL usually means:

```text
fewer replicas needed
lower latency
higher availability
more stale risk
weaker acknowledgement
```

Example RF=3:

| CL | Required | Can tolerate replica down? |
|---|---:|---:|
| ONE | 1 | 2 |
| QUORUM | 2 | 1 |
| ALL | 3 | 0 |

But “down” includes:

- unreachable,
- too slow for timeout,
- overloaded,
- network partition,
- coordinator unable to contact.

ScyllaDB monitoring docs note that if RF=3 and CL=QUORUM, coordinator waits for 2 replies; consistency level errors occur when required replicas cannot be reached.

---

## 20. Timeout vs Unavailable

Important distinction.

### 20.1 Unavailable

Coordinator knows not enough replicas are available to satisfy CL.

Example:

```text
RF=3
CL=QUORUM
only 1 replica reachable
```

Operation fails before doing full work.

### 20.2 Timeout

Coordinator attempted operation but did not receive enough responses before timeout.

Example:

```text
RF=3
CL=QUORUM
A acked
B may have applied but response late
client timeout
```

Outcome unknown.

### 20.3 Why This Matters

Unavailable often means operation likely did not reach enough replicas.

Timeout means operation may have succeeded partially or fully.

Retry behavior differs.

---

## 21. Write Timeout Ambiguity

Write timeout does not mean write failed.

Possible states after timeout:

```text
0 replicas applied
1 replica applied
2 replicas applied
3 replicas applied
coordinator response lost
client timed out before success response
```

For RF=3 CL=QUORUM:

```text
if 2 replicas applied but response delayed, client sees timeout though write logically satisfied CL
```

Therefore:

```text
retry only if idempotent
```

For non-idempotent operations:

- counter increment,
- random event append,
- external side effect,
- status transition without version guard,

retry can duplicate or corrupt.

---

## 22. Read Timeout

Read timeout does not change data, so retry is usually safer.

But read retry can still cause issues:

- increased load during incident,
- different replica returns older version at low CL,
- pagination inconsistency,
- cache poisoning with stale null,
- repeated fanout causing storm.

Use:

- bounded retry,
- backoff/jitter,
- deadline budget,
- idempotent read semantics,
- avoid retrying huge fanout blindly.

---

## 23. Consistency and Idempotency

CL choice and idempotency are connected.

If write CL is lower or timeout possible, idempotency becomes more important.

Example idempotent event write:

```sql
INSERT INTO case_events_by_case_version_bucket (
    tenant_id, case_id, version_bucket, event_version, event_id, ...
) VALUES (?, ?, ?, ?, ?, ...);
```

Same retry:

```text
same full primary key
```

Non-idempotent:

```text
event_id = random UUID generated each retry
```

This creates duplicate events.

Java command handler should generate stable IDs before first attempt.

---

## 24. Consistency and Counters

Counters are special.

If:

```sql
UPDATE views SET count = count + 1 WHERE key = ?;
```

and client times out, retry may increment twice.

CL cannot solve this.

Options:

- avoid counters for critical exact counts,
- aggregate from idempotent events,
- use approximate counts,
- use sharded counters with reconciliation,
- use OLAP/batch for reporting,
- accept over/under count if product allows.

Counters deep dive is part 018.

---

## 25. Consistency and Derived Views

Suppose command writes:

```text
case_current_by_id at LOCAL_QUORUM
```

Then async projector writes:

```text
open_cases_by_assignee at LOCAL_ONE
```

Reading assignee view at LOCAL_QUORUM does not guarantee it contains latest case.

Because projection may not have happened.

Consistency level only applies to the table/operation being read.

It cannot make absent projection data appear.

So distinguish:

```text
replica consistency
```

from:

```text
application projection consistency
```

---

## 26. Consistency and Caches

If app cache stores old value, database CL cannot help.

Example:

```text
DB read LOCAL_QUORUM would return version 10.
App cache returns version 8.
```

Cache invalidation/freshness is separate.

Use:

- short TTL,
- version-aware cache,
- invalidate on write,
- avoid cache for strict decisions,
- read-through with version floor.

---

## 27. Consistency and Multi-DC

Multi-DC introduces scope.

Keyspace:

```sql
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc_jakarta': 3,
  'dc_singapore': 3
}
```

### 27.1 LOCAL_QUORUM in Jakarta

Waits for:

```text
2 of 3 Jakarta replicas
```

Does not wait for Singapore.

### 27.2 QUORUM Across All Replicas

Total RF:

```text
3 + 3 = 6
QUORUM = 4
```

A global QUORUM may involve cross-DC latency.

### 27.3 EACH_QUORUM

Waits for:

```text
2 in Jakarta and 2 in Singapore
```

High consistency/durability cost.

### 27.4 Common Pattern

```text
LOCAL_QUORUM for local authoritative operations
single writer/home region per entity
async cross-DC replication
explicit failover
```

---

## 28. Active-Active Writes

If both DCs write same partition/entity:

```text
Jakarta: status APPROVED
Singapore: status REJECTED
```

Both at LOCAL_QUORUM can succeed.

Conflict resolution may be last-write-wins at cell timestamp level.

This may violate business invariants.

Mitigation:

- home region per entity,
- route writes to owner,
- LWT with correct scope if feasible,
- conflict-free data type/design,
- append-only events with conflict resolution workflow,
- avoid active-active mutation for strict state.

Do not confuse multi-DC replication with safe active-active business writes.

---

## 29. Local DC Configuration in Java Driver

For LOCAL_* CLs, driver local datacenter configuration matters.

If misconfigured:

- request routes to wrong DC,
- LOCAL_QUORUM applies in wrong coordinator local DC,
- latency rises,
- consistency assumptions break,
- cross-region traffic increases.

Java driver configuration must explicitly set local datacenter.

Also avoid generic load balancers hiding topology.

---

## 30. Statement-Level CL in Java

Consistency level is often set at statement/profile level.

Conceptual Java:

```java
BoundStatement stmt = ps.bind(tenantId, caseId)
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM);
```

Better via execution profiles:

```text
profile: authoritative-read -> LOCAL_QUORUM
profile: derived-read -> LOCAL_ONE
profile: source-write -> LOCAL_QUORUM
profile: lwt-write -> LOCAL_QUORUM + LOCAL_SERIAL
```

Repository method should encode intent:

```java
findAuthoritativeCurrent(...)
findEventuallyConsistentFeed(...)
appendAuditEvent(...)
reserveCommandIdempotency(...)
```

Avoid generic:

```java
save(entity)
findById(id)
```

without CL semantics.

---

## 31. CL Selection by Table Authority

Use authority classification from part 012.

| Table Type | Typical Read CL | Typical Write CL |
|---|---|---|
| source audit event | LOCAL_QUORUM | LOCAL_QUORUM |
| authoritative current state | LOCAL_QUORUM | LOCAL_QUORUM / LWT |
| idempotency guard | LOCAL_QUORUM | LWT + LOCAL_QUORUM |
| derived queue | LOCAL_ONE or LOCAL_QUORUM | LOCAL_ONE or LOCAL_QUORUM |
| notification feed | LOCAL_ONE | LOCAL_ONE/LOCAL_QUORUM |
| dashboard aggregate | LOCAL_ONE | async/projection |
| search index | external semantics | projection |
| cache-like table | LOCAL_ONE | LOCAL_ONE |

These are starting points. Final choice depends on business semantics.

---

## 32. CL Selection by Operation

Same table may have different CL per operation.

Example `case_current_by_id`:

```text
command transition read/write -> LOCAL_QUORUM/LWT
UI read current state -> LOCAL_QUORUM
background non-critical refresh -> LOCAL_ONE maybe
```

Example `notifications_by_user_day`:

```text
insert notification -> LOCAL_QUORUM if loss bad
read feed -> LOCAL_ONE
mark read -> maybe LOCAL_QUORUM or LOCAL_ONE depending UX
```

Do not assume table-level CL is enough.

---

## 33. Decision Tree

Ask:

```text
1. Is this source-of-truth?
2. Is stale read acceptable?
3. Is write loss/partial write acceptable?
4. Is read-your-write required?
5. Is operation idempotent?
6. Is this multi-DC?
7. Is latency budget tight?
8. What failure should be tolerated?
9. Can data be rebuilt?
10. Does operation enforce invariant?
```

If source/invariant:

```text
LOCAL_QUORUM or LWT
```

If derived/stale okay:

```text
LOCAL_ONE may be acceptable
```

If multi-DC local UX:

```text
LOCAL_QUORUM/LOCAL_ONE, not global QUORUM unless needed
```

If uniqueness/CAS:

```text
LWT with serial consistency
```

---

## 34. Examples

### 34.1 Append Audit Event

Requirement:

```text
event must not be lost
retry safe
source of truth
```

Candidate:

```text
Write CL: LOCAL_QUORUM
Read CL: LOCAL_QUORUM for audit UI, maybe LOCAL_ONE for non-critical preview
```

Use stable event_id/version.

### 34.2 Read Current Case

Requirement:

```text
must not show stale/regressed state for decision
```

Candidate:

```text
Read CL: LOCAL_QUORUM
```

If UI can tolerate slight staleness:

```text
LOCAL_ONE + version check/cache maybe
```

But command decisions should use authoritative path.

### 34.3 Notification Feed

Requirement:

```text
eventual okay
```

Candidate:

```text
Write CL: LOCAL_ONE or LOCAL_QUORUM depending loss tolerance
Read CL: LOCAL_ONE
```

### 34.4 Command Idempotency

Requirement:

```text
no duplicate command application
```

Candidate:

```text
INSERT IF NOT EXISTS
Normal CL: LOCAL_QUORUM
Serial CL: LOCAL_SERIAL
```

Need handle LWT timeout/unknown.

### 34.5 Search Index Projection

CL in ScyllaDB source write does not make search index fresh.

Use projection lag SLO and reconciliation.

---

## 35. Lower CL for Latency: When Is It Fine?

Use lower CL when:

- stale acceptable,
- table rebuildable,
- no critical invariant,
- latency budget strict,
- user experience tolerates lag,
- source table can be checked before final action.

Example:

```text
Open queue list at LOCAL_ONE,
but when user acts on case, command reads case_current at LOCAL_QUORUM and validates status.
```

This is a common pattern:

```text
derived candidate list can be stale
authoritative action validates source
```

---

## 36. Higher CL: When Is It Necessary?

Use stronger CL when:

- source-of-truth write,
- regulatory/audit durability,
- read-your-write required,
- stale read causes wrong decision,
- data not easily rebuildable,
- business invariant depends on freshness.

Examples:

- case current state,
- audit event,
- idempotency guard,
- authorization state,
- financial state.

---

## 37. Consistency Is Not Isolation

Even with QUORUM:

Two clients can concurrently:

```text
read version=1
both write version=2
```

without conditional guard, last-write-wins may resolve conflict.

For compare-and-set:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE tenant_id = ? AND case_id = ?
IF version = ? AND status = ?;
```

Use LWT or serialized command handler.

CL controls replica acknowledgement, not business concurrency by itself.

---

## 38. Consistency Is Not Constraint

CL does not enforce:

- uniqueness of email,
- foreign key existence,
- valid status transition,
- balance non-negative,
- exactly-once external call,
- count correctness.

Those require:

- LWT/reservation tables,
- application state machines,
- idempotency,
- relational DB if invariant broad,
- workflow/reconciliation.

---

## 39. LWT Preview

Lightweight transaction provides conditional update semantics using Paxos/Raft-like coordination depending ScyllaDB version/implementation.

Use for:

```text
IF NOT EXISTS
IF version = expected
IF status = expected
```

Costs:

- higher latency,
- more coordination,
- lower throughput,
- contention sensitivity.

Do not use LWT for every write.

Use it where invariant needs it.

Part 014 goes deep.

---

## 40. CL and Speculative Execution

Drivers may use speculative execution: sending duplicate request to another node if first is slow.

This can reduce latency but increase load and duplicate execution risk.

For idempotent reads, safer.

For non-idempotent writes, dangerous unless explicitly idempotent.

Java driver has idempotence flags/settings. Ensure statement idempotence matches reality.

Consistency level plus speculative execution plus retry policy can produce surprising load.

---

## 41. CL and Retry Policy

Retry policy must consider:

- CL,
- operation type,
- idempotency,
- timeout vs unavailable,
- read vs write,
- LWT,
- statement deadline.

Unsafe:

```text
retry all write timeouts automatically
```

Safer:

```text
retry idempotent writes with same key
do not retry non-idempotent writes
read status after unknown LWT
bounded retries with backoff
deadline budget
```

Repository contract should classify writes.

---

## 42. CL and Timeout Settings

If request timeout too low:

```text
false timeouts
unknown writes
retry storms
```

If too high:

```text
threads/in-flight requests pile up
user waits too long
backpressure delayed
```

Timeout should align with:

- endpoint SLO,
- DB p99,
- retry budget,
- fanout count,
- CL,
- LWT cost,
- cross-DC latency.

Do not “fix” consistency errors by blindly increasing timeout.

---

## 43. CL and Fanout

If request fans out to N partitions, CL cost multiplies.

Example:

```text
open queue reads 16 buckets at LOCAL_QUORUM
```

Each bucket read contacts quorum replicas.

Total replica work increases.

If derived queue stale acceptable:

```text
LOCAL_ONE may be better
```

then action validates source at LOCAL_QUORUM.

This is how table authority affects CL.

---

## 44. CL and Large Partitions

Higher CL cannot fix large partition.

If query scans huge tombstone-heavy partition at LOCAL_QUORUM, it may be slower than LOCAL_ONE but still fundamentally bad.

CL selection is not substitute for data modeling.

Use:

- bounded partition,
- better clustering,
- bucket,
- compaction strategy,
- tombstone reduction.

---

## 45. CL and Repair

Lower CL increases chance replicas diverge temporarily, making repair/hints/read repair more important.

But even with QUORUM, repair remains necessary.

Hints/read repair/repair are convergence mechanisms.

CL is per-operation acknowledgement.

Do not think:

```text
we use QUORUM, so no repair needed
```

Wrong.

---

## 46. Failure Scenario Matrix

| Scenario | CL ONE | CL LOCAL_QUORUM |
|---|---|---|
| one replica down RF=3 | likely succeeds | succeeds if 2 local replicas reachable |
| two replicas down RF=3 | may succeed if one reachable | fails |
| one replica slow | may avoid slow replica | may timeout if needed replica slow |
| stale replica read | possible | less likely due quorum |
| write timeout | outcome unknown | outcome unknown |
| read after write | not guaranteed | stronger if both local quorum |
| multi-DC remote down | LOCAL_ONE unaffected | LOCAL_QUORUM local unaffected |
| active-active conflict | possible | possible |

---

## 47. Practical CL Profiles

Define named profiles.

```text
SOURCE_WRITE
  CL: LOCAL_QUORUM
  idempotent required
  timeout: moderate

AUTHORITATIVE_READ
  CL: LOCAL_QUORUM
  used for decisions

DERIVED_READ_FAST
  CL: LOCAL_ONE
  stale acceptable

DERIVED_WRITE
  CL: LOCAL_ONE or LOCAL_QUORUM
  idempotent projection

LWT_GUARD
  CL: LOCAL_QUORUM
  Serial CL: LOCAL_SERIAL
  timeout: higher
  retry: read-after-timeout

BATCH_EXPORT_READ
  CL: LOCAL_ONE/LOCAL_QUORUM depending requirement
  throttle, paging
```

Profiles make consistency explicit in code/config.

---

## 48. Java Example: Execution Profiles

Conceptual config:

```hocon
datastax-java-driver {
  profiles {
    source-write {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.timeout = 500 milliseconds
    }

    authoritative-read {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.timeout = 300 milliseconds
    }

    derived-read-fast {
      basic.request.consistency = LOCAL_ONE
      basic.request.timeout = 150 milliseconds
    }

    lwt-guard {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.serial-consistency = LOCAL_SERIAL
      basic.request.timeout = 1500 milliseconds
    }
  }
}
```

Repository:

```java
BoundStatement stmt = ps.bind(...)
    .setExecutionProfileName("authoritative-read");
```

Exact syntax depends on driver version, but the principle is stable:

```text
CL belongs to operation profile.
```

---

## 49. Java Example: Repository Contracts

Bad:

```java
Optional<CaseCurrent> findById(CaseId id);
void save(CaseCurrent c);
```

Better:

```java
CompletionStage<Optional<CaseCurrent>> findAuthoritativeCurrent(
    TenantId tenantId,
    CaseId caseId
);

CompletionStage<Optional<CaseCurrent>> findFastPossiblyStaleCurrent(
    TenantId tenantId,
    CaseId caseId
);

CompletionStage<Void> appendAuditEventIdempotent(
    CaseAuditEvent event
);

CompletionStage<IdempotencyReservationResult> reserveCommandIfAbsent(
    TenantId tenantId,
    CommandId commandId
);
```

Method name communicates CL/freshness/idempotency.

---

## 50. Testing Consistency Behavior

Test:

```text
1. write LOCAL_ONE then read LOCAL_ONE from different connection
2. write LOCAL_QUORUM then read LOCAL_QUORUM
3. write timeout and retry idempotent
4. non-idempotent write timeout not retried
5. LWT timeout then read command row
6. derived projection lag
7. multi-DC LOCAL_QUORUM behavior
8. node down RF=3 CL behavior
9. stale cache vs DB CL
10. fanout LOCAL_ONE vs LOCAL_QUORUM latency
```

Use chaos/failure tests where possible.

---

## 51. Observability

Track:

```text
read/write latency by CL
timeouts by CL
unavailable errors by CL
retry count by operation
speculative execution count
LWT latency/contention
stale derived row rate
projection lag
read-your-write failures if detectable
per-table CL usage
driver local DC
cross-DC traffic
```

A production system should answer:

```text
Which consistency profile is failing?
Which table?
Which endpoint?
Which CL?
Timeout or unavailable?
```

---

## 52. Common Misconceptions

### Misconception 1: “QUORUM means strongly consistent like SQL.”

No. It gives quorum overlap, not serializable transactions.

### Misconception 2: “RF=3 means every write goes to 3 before success.”

No. CL determines required acks.

### Misconception 3: “Timeout means failed.”

No. Timeout means unknown.

### Misconception 4: “LOCAL_QUORUM protects against active-active conflicts.”

No. It protects local quorum; concurrent remote writes can still conflict.

### Misconception 5: “Higher CL fixes bad data model.”

No. It can make bad query slower.

### Misconception 6: “Derived view read at QUORUM ensures source freshness.”

No. Projection lag is application-level.

### Misconception 7: “Use ALL for maximum correctness.”

ALL reduces availability and still does not enforce business invariants.

### Misconception 8: “Retry policy can be generic.”

No. Retry depends on idempotency and operation semantics.

---

## 53. Mental Model Compression

Remember:

```text
RF = how many copies should exist.
CL = how many copies must answer now.
R + W > RF = quorum overlap.
Quorum overlap improves freshness.
It is not a transaction.
```

And:

```text
Consistency level is chosen per operation based on table authority, stale tolerance, latency budget, and failure behavior.
```

---

## 54. Summary

Consistency levels are a core tool for balancing latency, availability, and freshness.

Key lessons:

1. RF and CL are different.
2. QUORUM is `floor(RF/2)+1`.
3. Read/write quorum overlap when `R + W > RF`.
4. CL ONE gives low latency/high availability but allows stale reads.
5. LOCAL_ONE confines ONE to local DC.
6. QUORUM/LOCAL_QUORUM are common for authoritative operations.
7. LOCAL_QUORUM is usually preferred in multi-DC local operations.
8. ALL is rarely a good default because availability suffers.
9. ANY is write-only and should be used with extreme caution.
10. SERIAL/LOCAL_SERIAL are for LWT conditional semantics.
11. Quorum does not equal SQL transaction/isolation.
12. Timeout means outcome unknown.
13. Retry must depend on idempotency.
14. Derived view consistency is not fixed by higher CL if projection lags.
15. Multi-DC active-active writes need conflict strategy.
16. Java driver local DC and execution profiles are production-critical.
17. CL should be encoded in repository/operation contracts.
18. Observability should track CL-specific latency/errors/retries.

---

## 55. Review Questions

1. Apa perbedaan replication factor dan consistency level?
2. Bagaimana menghitung quorum untuk RF=3 dan RF=5?
3. Apa arti `R + W > RF`?
4. Mengapa write QUORUM + read QUORUM memberi overlap?
5. Kenapa quorum bukan serializable transaction?
6. Kapan CL ONE cocok?
7. Kapan CL ONE berbahaya?
8. Apa beda QUORUM dan LOCAL_QUORUM?
9. Kenapa LOCAL_QUORUM umum di multi-DC?
10. Apa risiko active-active write dengan LOCAL_QUORUM?
11. Kapan CL ALL masuk akal?
12. Kenapa ANY jarang dipakai untuk data kritikal?
13. Apa fungsi SERIAL/LOCAL_SERIAL?
14. Apa beda timeout dan unavailable?
15. Kenapa write timeout outcome unknown?
16. Bagaimana CL berhubungan dengan idempotency?
17. Kenapa derived view read QUORUM tidak menjamin source update terlihat?
18. Bagaimana Java driver local DC memengaruhi LOCAL_QUORUM?
19. Apa itu consistency profile di aplikasi?
20. Metrik apa yang perlu dimonitor per CL?

---

## 56. Practical Exercise

Gunakan table dari regulatory case management:

```text
case_events_by_case_version_bucket
case_current_by_id
open_cases_by_assignee_day_bucket
notifications_by_user_day
command_idempotency_by_id
case_counts_by_status_day
```

Untuk setiap operasi berikut, pilih CL dan jelaskan trade-off:

```text
1. append audit event
2. read latest audit events for case detail
3. transition case state with expected version
4. read current case for UI display
5. read current case before enforcement decision
6. write assignee derived view
7. read assignee queue list
8. user clicks case from assignee queue and acts
9. insert notification
10. read notification feed
11. reserve command idempotency key
12. update dashboard count
13. read dashboard count
14. backfill derived table
15. export audit history
```

Untuk setiap jawaban, tulis:

```text
table authority
stale tolerance
read/write CL
serial CL if any
retry behavior
timeout behavior
whether operation is idempotent
fallback/reconciliation
```

---

## 57. Preview Part 014

Part berikutnya akan membahas:

```text
Lightweight Transactions, Paxos/Raft Semantics, CAS
```

Kita akan memperdalam:

- `IF NOT EXISTS`,
- `IF column = value`,
- uniqueness reservation,
- expected version transition,
- LWT cost,
- contention,
- SERIAL/LOCAL_SERIAL,
- timeout ambiguity,
- Java retry strategy,
- when not to use LWT.

Part 013 menjelaskan consistency level.

Part 014 akan menjelaskan conditional correctness.

---

# End of Part 013


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Multi-Access-Pattern Design: Duplicate Tables, Fanout, dan Derived Views</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-014.md">Part 014 — Lightweight Transactions, CAS, Paxos/Raft Semantics, dan Conditional Correctness ➡️</a>
</div>

# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-020.md

# Part 020 — Replication, High Availability, Read Scaling, and Failure Modes

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 020 dari 035  
> Fokus: replica set, primary election, oplog, replication lag, read preference, read concern, write concern, failover, stale reads, causal consistency, backup/restore, dan runbook HA  
> Target pembaca: Java software engineer yang ingin memahami MongoDB bukan hanya sebagai database API, tetapi sebagai distributed system yang harus dipakai dengan model kegagalan yang benar

---

## 0. Posisi Part Ini Dalam Seri

Part 018 dan 019 membahas performance pada read path dan write path. Sekarang kita naik satu layer: **availability dan failure behavior**.

MongoDB production deployment biasanya tidak dijalankan sebagai satu node tunggal. Untuk production, MongoDB umumnya dijalankan sebagai:

```text
replica set
```

atau:

```text
sharded cluster yang setiap shard-nya adalah replica set
```

High availability bukan berarti “database tidak pernah gagal”. High availability berarti:

```text
ketika node gagal, sistem punya mekanisme untuk memilih primary baru, menjaga data tetap tersedia sesuai konfigurasi, dan memberi aplikasi cara eksplisit untuk menangani periode transisi.
```

Sebagai Java engineer, kamu perlu paham:

- kapan write bisa timeout,
- kapan read bisa stale,
- kapan retry aman,
- kapan failover terlihat sebagai error,
- kapan read preference berbahaya,
- kapan write concern terlalu lemah,
- bagaimana replication lag memengaruhi user journey,
- bagaimana backup/restore masuk ke architecture, bukan hanya ops checklist.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan replica set dengan primary, secondary, election, dan oplog.
2. Memahami bagaimana write direplikasi.
3. Memahami apa yang terjadi saat primary gagal.
4. Membaca risiko replication lag.
5. Memilih read preference berdasarkan use case, bukan sekadar “scale reads”.
6. Memilih read concern dan write concern berdasarkan consistency requirement.
7. Menjelaskan stale read, read-your-write, monotonic read, dan causal consistency.
8. Mendesain Java retry behavior saat failover.
9. Membedakan high availability, durability, dan disaster recovery.
10. Membuat failure-mode checklist untuk MongoDB-backed service.
11. Membuat runbook awal untuk incident seperti primary down, lag tinggi, slow majority write, dan stale secondary reads.

---

## 2. Mental Model: Availability Tidak Sama Dengan Consistency

Ada tiga konsep yang sering dicampur:

```text
availability:
  sistem tetap bisa menerima operasi

durability:
  data yang sudah acknowledged tidak hilang dalam failure tertentu

consistency:
  pembaca melihat data sesuai jaminan yang dibutuhkan
```

Contoh trade-off:

```text
Read from secondary:
  bisa menambah read availability/capacity
  tapi bisa stale

Write with w:1:
  lebih cepat
  tapi lebih lemah terhadap primary crash sebelum replication

Write with majority:
  lebih kuat
  tapi bisa lebih lambat saat replica lag

Read with majority/snapshot:
  lebih kuat
  tapi bisa lebih mahal/terbatas
```

Tidak ada setting universal terbaik.

Setting harus dipilih per use case.

---

## 3. Replica Set: Struktur Dasar

Replica set adalah sekelompok `mongod` yang menyimpan copy dataset yang sama.

Komponen utama:

```text
primary:
  menerima write

secondary:
  mereplikasi data dari primary dan dapat melayani read jika read preference mengizinkan

arbiter:
  ikut voting election tetapi tidak menyimpan data
```

Production modern sebaiknya mengutamakan data-bearing nodes, bukan bergantung pada arbiter kecuali benar-benar paham trade-off.

Topologi sederhana:

```text
Replica Set rs0

+-------------+      replication      +---------------+
| Primary     |  ------------------>  | Secondary A   |
| node-1      |                       | node-2        |
+-------------+                       +---------------+
        |
        | replication
        v
+---------------+
| Secondary B   |
| node-3        |
+---------------+
```

Write masuk ke primary. Secondary mengikuti perubahan dari primary.

---

## 4. Primary

Primary adalah node yang menerima semua write untuk replica set.

Aplikasi Java biasanya tidak perlu tahu node mana primary secara manual. Driver MongoDB melakukan server discovery dan routing berdasarkan topology metadata.

Namun aplikasi tetap merasakan efek primary:

- write diarahkan ke primary,
- primary down menyebabkan write error sementara,
- election menciptakan periode transisi,
- retryable writes bisa membantu sebagian kasus,
- transaction commit bisa menghasilkan uncertainty,
- read preference `primary` akan gagal sementara jika tidak ada primary.

---

## 5. Secondary

Secondary mereplikasi data dari primary.

Secondary bisa digunakan untuk read jika read preference mengizinkan:

```text
secondary
secondaryPreferred
nearest
```

Namun secondary bisa tertinggal.

Pertanyaan penting:

```text
Apakah endpoint ini boleh membaca data lama?
```

Jika tidak, jangan asal read from secondary.

Contoh secondary read yang mungkin acceptable:

- dashboard approximate,
- reporting yang toleran delay,
- archive browsing,
- public catalog non-critical,
- offline batch validation.

Contoh secondary read yang berbahaya:

- workflow state decision,
- authorization check,
- payment/financial decision,
- “setelah update langsung lihat hasil”,
- idempotency lookup,
- case transition guard,
- legal decision state.

---

## 6. Election

Jika primary tidak tersedia, replica set dapat melakukan election untuk memilih primary baru.

Selama election:

```text
write may fail
primary reads may fail
driver topology changes
some operations may be retried
transactions may abort
latency spikes can occur
```

Election bukan bug. Itu bagian dari HA.

Aplikasi harus siap terhadap error sementara.

Java service yang sehat:

```text
does not assume database is either perfect or permanently down
handles transient errors with bounded retry
uses idempotency for writes
has request deadlines
surfaces temporary unavailability clearly
does not create retry storm
```

---

## 7. Oplog

Oplog adalah log operasi yang digunakan secondary untuk mereplikasi perubahan.

Mental model:

```text
primary applies write
operation recorded in oplog
secondary pulls/applies oplog entries
secondary catches up
```

Oplog punya ukuran/window.

Jika secondary terlalu lama tertinggal sampai oplog entry yang dibutuhkan sudah tidak ada, secondary bisa tidak dapat catch up dan perlu resync.

Sebagai application engineer, kamu tidak perlu mengelola oplog harian, tetapi perlu memahami efeknya:

- write-heavy bursts dapat meningkatkan lag,
- secondary lambat dapat tertinggal,
- long-running maintenance bisa memengaruhi lag,
- replication lag memengaruhi stale reads dan majority write behavior.

---

## 8. Replication Lag

Replication lag = secondary tertinggal dari primary.

Contoh:

```text
primary latest write: 10:00:00
secondary latest applied: 09:59:45
lag: 15 seconds
```

Jika aplikasi read from secondary, user bisa membaca state lama.

Gejala:

```text
user updates case status to ESCALATED
UI refresh reads from secondary
UI still shows UNDER_REVIEW
user clicks escalate again
application sees stale state
confusion or duplicate command
```

Solusi:

- use primary read for state-sensitive flows,
- causal consistency where appropriate,
- read concern/write concern deliberate,
- route post-write reads to primary,
- expose eventual consistency in UI,
- use polling/refresh that can tolerate lag,
- monitor replication lag.

---

## 9. Read Preference

Read preference menentukan dari node mana driver membaca.

Common modes:

```text
primary
primaryPreferred
secondary
secondaryPreferred
nearest
```

### 9.1 primary

Read dari primary.

Use for:

- default operational reads,
- state machine decisions,
- read-your-write,
- consistency-sensitive use cases.

Trade-off:

- read load ke primary,
- saat primary tidak tersedia, read gagal sementara.

### 9.2 primaryPreferred

Read dari primary jika ada, fallback ke secondary.

Use carefully.

Risk:

- saat failover, fallback secondary bisa stale.
- endpoint behavior berubah saat incident.

### 9.3 secondary

Read hanya dari secondary.

Use for:

- stale-tolerant workloads,
- reporting,
- offloading read.

Risk:

- stale reads,
- secondary overload affects replication,
- not safe for workflow decision.

### 9.4 secondaryPreferred

Read dari secondary jika ada, fallback primary.

Useful for reporting maybe.

Risk:

- inconsistent freshness,
- load can unexpectedly shift.

### 9.5 nearest

Chooses low-latency node based on topology/latency.

Risk:

- may read from secondary,
- freshness depends on node.

---

## 10. Read Preference Is A Business Decision

Jangan pilih `secondary` karena “scale read” tanpa memahami semantics.

Pertanyaan:

```text
If this read is 5 seconds stale, is it acceptable?
If stale by 60 seconds?
If stale during incident?
Can user make wrong decision?
Can stale read cause duplicate side effect?
Can stale read leak unauthorized data?
Can stale read violate regulatory defensibility?
```

Contoh matrix:

```text
Case transition guard:
  read preference: primary

Case detail after update:
  primary or causal session

Dashboard open count:
  secondary possible if labelled stale/approximate

Archive report:
  secondary possible

Authorization lookup:
  primary/strongly consistent source

Search autocomplete:
  stale acceptable

Idempotency command lookup:
  primary / majority semantics
```

---

## 11. Write Concern

Write concern menentukan acknowledgement write.

Common forms:

```text
w: 1
w: majority
j: true
wtimeout
```

### 11.1 w:1

Primary acknowledges after applying write locally.

Pros:

- lower latency.

Cons:

- if primary fails before replication, acknowledged write may be at risk depending failure/election details.

### 11.2 majority

Acknowledged after majority of voting data-bearing nodes have acknowledged.

Pros:

- stronger durability across failover.

Cons:

- higher latency,
- sensitive to replication lag,
- can timeout if majority unavailable.

### 11.3 j:true

Requires journaling acknowledgement depending configuration/version specifics.

Application-level principle:

```text
Use stronger write concern for writes whose loss is unacceptable.
```

---

## 12. Write Concern Error

A write concern error is not the same as write failure.

Example:

```text
primary applied write
but majority acknowledgement timed out
```

Application receives uncertainty:

```text
write may have happened
```

If application blindly retries non-idempotent operation, duplicate effect can occur.

Hence:

```text
write concern + retry => idempotency required
```

For critical commands, use deterministic IDs and idempotency records.

---

## 13. Read Concern

Read concern controls what data is returned in terms of acknowledgement/visibility semantics.

Common conceptual levels:

```text
local:
  most recent data known to node, can include data not majority committed

majority:
  data acknowledged by majority

snapshot:
  transaction/snapshot semantics in supported contexts

linearizable:
  strongest single-document read from primary under constraints
```

Application principle:

```text
Read concern should match correctness need.
```

Do not use strongest setting everywhere without reason. Do not use weakest setting where correctness depends on confirmed state.

---

## 14. Consistency Concepts

### 14.1 Stale Read

Read returns older value.

```text
primary: status = ESCALATED
secondary: status = UNDER_REVIEW
```

### 14.2 Read-Your-Write

After client writes, same client reads and sees its write.

Important for UX and command confirmation.

### 14.3 Monotonic Read

Client should not see time go backward.

Example bad:

```text
first read: status ESCALATED
second read: status UNDER_REVIEW
```

Can happen if reads go to different nodes with different lag.

### 14.4 Causal Consistency

A session can preserve cause-effect ordering for operations where configured/supported.

Useful when:

```text
write A happens-before read B
read B should reflect A
```

But it requires using sessions correctly and still depends on topology/concerns.

---

## 15. Java Driver Topology Awareness

MongoDB Java driver maintains topology knowledge:

```text
servers
roles
latency
replica set name
primary/secondary state
pool per server
```

The app should not hardcode primary host.

Connection string should list multiple hosts or use SRV when appropriate:

```text
mongodb://host1,host2,host3/?replicaSet=rs0
```

or Atlas-style SRV.

The driver handles:

- server selection,
- primary discovery,
- read preference routing,
- retryable writes if enabled/supported,
- connection pool management.

But driver cannot decide your business consistency semantics.

---

## 16. Server Selection Timeout

When driver needs a server matching operation requirement:

```text
write needs primary
read with primary needs primary
read with secondary needs secondary
```

If none available within server selection timeout, operation fails.

During election, writes may fail with server selection timeout or transient errors.

Do not set timeout extremely high for interactive endpoints.

Bad:

```text
serverSelectionTimeout = 60s
HTTP timeout = 30s
```

Thread may wait too long.

Better:

```text
serverSelectionTimeout fits endpoint budget
request deadline controls retry
transient errors are handled with bounded retry/backoff
```

---

## 17. Failover Timeline From Application Perspective

Example:

```text
T0: primary healthy
T1: primary unreachable
T2: driver detects topology change
T3: writes fail temporarily
T4: replica set elects new primary
T5: driver discovers new primary
T6: writes resume
```

Application symptoms:

```text
increased latency
transient write errors
transaction aborts
connection errors
server selection errors
unknown commit result
retry attempts
some user requests fail
```

Healthy app behavior:

```text
short retry for idempotent operations
clear error for non-idempotent/unsafe operations
no retry storm
no long thread pileup
metrics/alerts show failover
```

---

## 18. Retry Strategy During Failover

Use retries only when:

1. error is transient,
2. operation is idempotent or protected by idempotency key,
3. request deadline has enough time,
4. retry count is bounded,
5. backoff/jitter applied.

Do not retry:

- validation errors,
- authorization errors,
- invalid state transitions without changed command,
- duplicate key unless interpreted as idempotent success,
- broad expensive queries during overload,
- operations after request deadline.

Example policy:

```text
interactive write:
  max attempts 2
  short exponential backoff + jitter
  requires commandId/idempotency

background job:
  max attempts per cycle 3
  longer backoff
  persisted attempt count
  dead-letter after threshold
```

---

## 19. Unknown Commit Result

In transaction commit, client may not know whether commit succeeded.

Scenario:

```text
client sends commit
server commits
network fails before response
client sees UnknownTransactionCommitResult
```

If retry is not idempotent, danger.

For commands:

```text
use commandId
use deterministic audit/outbox IDs
make retry discover prior completion
```

The right question is not:

```text
Did my last RPC return success?
```

But:

```text
What is the durable state of commandId X?
```

---

## 20. Designing For Command Idempotency Under Failover

Command collection:

```javascript
{
  _id: "tenant:t1:cmd:cmd-123",
  tenantId: "t1",
  commandId: "cmd-123",
  commandType: "ESCALATE_CASE",
  targetId: "case-1",
  status: "COMPLETED",
  result: {
    transitionId: "tr-999"
  },
  createdAt,
  completedAt
}
```

On retry after failover:

```text
look up commandId
if completed:
  return previous result
if in progress but lease expired:
  recover or retry
if not found:
  attempt again
```

This pattern turns uncertain network outcomes into deterministic application behavior.

---

## 21. Read Scaling With Secondaries: Real Constraints

Using secondaries for read scaling can help, but not always.

Constraints:

1. secondaries must still replicate,
2. heavy secondary reads can slow replication,
3. stale data risk,
4. secondary hardware must be sized,
5. query indexes must exist on secondaries too,
6. long analytics queries can disturb cluster,
7. read preference behavior during failure must be understood.

Secondaries are not free read replicas in the abstract. They are part of replication health.

If reporting workload is heavy, consider:

- dedicated analytics node,
- hidden secondary,
- separate reporting cluster,
- ETL/warehouse,
- materialized summaries,
- Atlas/managed analytics options if applicable.

---

## 22. Hidden Secondary / Delayed Secondary Concept

Some deployments use special secondaries for operational purposes:

```text
hidden secondary:
  not selected for normal reads

delayed secondary:
  intentionally lags, useful for certain recovery scenarios
```

These are operational patterns and should be coordinated with DBAs/platform team.

As app engineer, do not assume every secondary is suitable for read traffic.

---

## 23. Stale Read Failure Stories

### 23.1 Duplicate Workflow Action

Flow:

```text
user escalates case
write succeeds on primary
UI reload reads from secondary
secondary still shows UNDER_REVIEW
user escalates again
```

Fix:

- post-write reads from primary,
- command idempotency,
- UI disables repeated action based on command response,
- backend state transition guard.

### 23.2 Authorization Drift

Flow:

```text
admin removes user's permission
secondary lags
user request checks permission from secondary
access granted incorrectly
```

Fix:

- authorization-critical reads from primary/strong source,
- token/session invalidation design,
- do not use stale read for security boundary.

### 23.3 Inconsistent Dashboard

Flow:

```text
dashboard count shows old value
```

Maybe acceptable if dashboard labelled eventually consistent.

Fix depends on requirement.

---

## 24. Majority Write Does Not Mean Every Secondary Has It

If write concern is majority:

```text
majority nodes acknowledged
```

But not all secondaries necessarily have applied it.

A secondary read from a lagging secondary can still miss the write.

Thus:

```text
majority write + secondary read
does not automatically guarantee read-your-write
```

You need correct read concern/preference/session semantics for the use case.

---

## 25. Majority Read Does Not Automatically Mean Freshest

Read concern majority means read returns data that has been acknowledged by majority, but if reading from secondary, freshness can still depend on that node's replication progress.

Always reason about both:

```text
read preference: where do I read from?
read concern: what visibility level do I require?
```

---

## 26. Session and Causal Consistency

A causally consistent session can help preserve ordering for operations in that session.

Conceptual flow:

```text
session write
session read
driver includes causal metadata
read waits/targets appropriately so it reflects prior write
```

Use for:

- read after write in same logical request/session,
- workflows where user must see own update,
- multi-operation flows without full transaction.

But still:

- requires correct driver usage,
- has latency trade-off,
- does not replace domain idempotency,
- not magic across arbitrary services unless context propagated.

---

## 27. Cross-Service Causal Context

In microservices:

```text
Service A writes
Service B reads
```

Causal consistency is harder because session context may not propagate.

Options:

1. Service B reads from primary.
2. Service A returns durable result and caller trusts it.
3. Propagate operation time/cluster time if architecture supports.
4. Use event/outbox projection with explicit lag.
5. Avoid immediate cross-service read-after-write dependency.
6. Use synchronous command boundary where consistency matters.

Most systems should avoid fragile cross-service read-after-write assumptions.

---

## 28. Failover and Transactions

Transactions during failover may abort.

Application must be ready to retry entire transaction if safe.

Transaction callback must not contain non-idempotent external side effects.

Bad:

```java
withTransaction(() -> {
  updateCase();
  sendEmail();
  insertAudit();
});
```

If transaction retries, email may be sent multiple times.

Better:

```java
withTransaction(() -> {
  updateCase();
  insertAudit();
  insertOutboxEmail();
});
```

Email sent by outbox after commit.

---

## 29. Replica Set and Java Connection Pool

Driver maintains pools per server.

During failover:

- pool to old primary may become invalid,
- new primary pool may need warmup,
- in-flight operations may fail,
- pool checkout latency may spike,
- server selection may retry.

Metrics to observe:

```text
pool checkout time
pool size per server
connection creation rate
command failure by error type
server selection failure
retry count
topology change event
```

Part 016 covered driver monitoring; here the key is linking those metrics to HA events.

---

## 30. Operational Readiness: Topology Change Events

Java driver monitoring can expose command and connection events; application/platform observability should correlate:

```text
Mongo topology change
primary election
application error spike
request p99 spike
retry count spike
replication lag
write concern timeout
```

If you only monitor HTTP 500 count, you will understand incidents too late.

---

## 31. Disaster Recovery Is Not High Availability

High availability:

```text
node fails, cluster continues or recovers quickly
```

Disaster recovery:

```text
region loss, data corruption, accidental deletion, ransomware, operator error, logical bug
```

Replica set is not backup.

If application accidentally runs:

```javascript
db.cases.updateMany({}, { $set: { status: "CLOSED" } })
```

replication faithfully replicates the mistake.

Need:

- backups,
- point-in-time recovery if required,
- restore drills,
- archive/export strategy,
- access control,
- migration safety,
- deletion guardrails.

---

## 32. Backup Concepts

Backup strategy should define:

```text
RPO: recovery point objective
  how much data loss is acceptable?

RTO: recovery time objective
  how long can restore take?

retention:
  how long backups are kept?

scope:
  whole cluster, database, collection, tenant?

security:
  encryption, access control, audit

testing:
  restore drill frequency
```

Example:

```text
RPO: 5 minutes
RTO: 2 hours
retention: 35 days daily, 12 months monthly
restore test: quarterly
```

Numbers depend on business.

---

## 33. Restore Is A Product Capability For Some Systems

In regulated/case management systems, restore is not only ops.

Questions:

```text
Can we restore one tenant?
Can we restore one case?
Can we prove chain of custody?
What happens to data written after backup?
How do we merge restored data?
Can restored data violate current schema?
How do we audit restore access?
```

Full cluster restore is simpler than selective restore.

Selective restore is application/domain problem.

---

## 34. Human Error Recovery

Human error examples:

- wrong migration,
- broad update,
- broad delete,
- wrong tenant filter,
- bad deployment writes malformed documents,
- index dropped,
- TTL misconfigured,
- archive job moved wrong records.

Prevention:

1. tenant filter guardrails,
2. dry run mode,
3. migration approval,
4. batch checkpoints,
5. backups before destructive migration,
6. canary tenant,
7. limited write credentials,
8. production safety flags,
9. observability alerts,
10. rollback plan.

---

## 35. Failure Mode: Primary Down

Symptoms:

```text
write failures
server selection timeouts
election event
p99 spike
transaction aborts
```

Immediate questions:

```text
Is new primary elected?
How long was election?
Are app retries bounded?
Are users seeing errors?
Any write concern errors?
Any unknown commit results?
Any retry storm?
```

Application behavior:

```text
idempotent commands retry briefly
non-idempotent commands return safe retryable error
background jobs back off
circuit breaker may open
```

Runbook:

```text
1. Confirm cluster topology.
2. Confirm new primary.
3. Check application error rate.
4. Check retry count.
5. Check write latency.
6. Check replication lag.
7. Check stuck transactions/jobs.
8. Verify no duplicate side effects.
```

---

## 36. Failure Mode: Replication Lag High

Symptoms:

```text
secondary lag rising
majority writes slower
secondary reads stale
change streams delayed
backup/analytics node behind
```

Possible causes:

- write spike,
- large batch migration,
- TTL/delete storm,
- secondary disk slow,
- network issue,
- heavy reads on secondary,
- index build,
- resource saturation.

Runbook:

```text
1. Identify lagging node(s).
2. Identify recent write-heavy jobs.
3. Check delete/TTL/archive activity.
4. Check secondary CPU/disk.
5. Check heavy secondary reads.
6. Throttle background jobs.
7. Consider shifting reads away.
8. Monitor catch-up.
```

Application decision:

```text
disable stale-sensitive secondary reads
reduce batch job rate
return dashboard stale indicator
pause archive/import jobs
```

---

## 37. Failure Mode: Majority Writes Timing Out

Symptoms:

```text
write concern timeout
writes maybe applied but not majority acknowledged
application sees uncertainty
```

Possible causes:

- majority unavailable,
- secondary lag,
- network partition,
- overloaded secondary,
- too strict wtimeout for current conditions.

Runbook:

```text
1. Do not blindly retry non-idempotent writes.
2. Check if write applied using idempotency key/business key.
3. Check replica health.
4. Check lag.
5. Check recent batch/delete storm.
6. Decide whether to fail closed or retry.
```

Application design:

```text
idempotency keys turn uncertain result into recoverable lookup
```

---

## 38. Failure Mode: Stale Secondary Read

Symptoms:

```text
user sees old data
monotonic read violation
workflow action appears available after completion
authorization inconsistency
```

Root cause:

```text
read preference permits secondary
secondary lag exists
```

Fix:

```text
state-sensitive endpoints use primary
post-write reads use primary/session semantics
security reads not from stale source
UI handles eventual projections explicitly
```

---

## 39. Failure Mode: Retry Storm

Symptoms:

```text
DB degraded
app retries increase
traffic amplification
pool exhaustion
more timeouts
```

Runbook:

```text
1. Check retry metrics.
2. Reduce retry attempts if configurable.
3. Open circuit breaker for non-critical operations.
4. Throttle background jobs.
5. Apply tenant-level rate limit.
6. Preserve critical writes.
7. Avoid broad expensive retries.
```

Long-term:

- deadline propagation,
- retry budget,
- idempotency,
- backpressure,
- load shedding.

---

## 40. Failure Mode: Backup Needed After Bad Migration

Scenario:

```text
migration changed wrong documents
replication copied mistake
```

Questions:

```text
Can we identify affected docs?
Can we reverse from audit?
Do we need restore?
Full cluster or selective restore?
What writes happened after migration?
How do we reconcile?
```

Safe migration design from Part 027 will cover this, but HA mindset already says:

```text
replication is not rollback
```

---

## 41. Designing Read Routes Per Use Case

Example regulatory case system:

```text
GET /cases/{id}/header:
  primary if used after commands; secondary possible for read-only stale-tolerant screens?

POST /cases/{id}/escalate:
  write primary, guarded update, majority, idempotency

GET /cases/worklist:
  primary or materialized projection depending freshness requirement

GET /dashboards/supervisor:
  secondary/materialized summary acceptable with stale indicator

GET /audit/{caseId}:
  primary or secondary depending compliance/freshness; usually not decision-critical but must be complete enough

GET /permissions/me:
  primary/authoritative store
```

Design per endpoint.

Do not set global `secondaryPreferred` because “reads are heavy”.

---

## 42. Read Preference In Spring Data / Java

Be careful with global configuration.

If you configure global read preference:

```text
secondaryPreferred
```

you may accidentally make all repository reads stale-tolerant, including ones that are not.

Better:

- default primary,
- explicit secondary read for known safe query,
- separate template/client for reporting if needed,
- code-level naming that makes stale read visible.

Example naming:

```java
casePrimaryQueries.findCurrentState(...)
caseReportingQueries.findDashboardSummaryPossiblyStale(...)
```

Naming matters.

---

## 43. UX For Eventual Consistency

If data is eventually consistent, UI should not pretend otherwise.

Patterns:

```text
"Updated. Some dashboards may take up to 30 seconds to refresh."

"Showing data last updated at 10:03:12."

"Search index is updating."

Disable repeated action after command accepted.

Return command result directly instead of forcing immediate refetch from stale projection.
```

Engineering consistency must match user journey.

---

## 44. Monitoring Checklist

Cluster metrics:

```text
primary availability
election count
replication lag
oplog window
write concern errors
read/write latency
connections
CPU
memory/cache
disk I/O
network
page faults/cache misses where applicable
```

Application metrics:

```text
server selection timeout
command timeout
retry count
unknown commit result
pool checkout time
operation latency by repository method
read preference usage
write concern timeout
matchedCount=0 conflict count
duplicate key count
```

Business metrics:

```text
command success rate
case transition failure rate
audit/event divergence
projection lag
outbox lag
dashboard freshness
tenant-level error rate
```

---

## 45. Alerting Principles

Bad alert:

```text
CPU > 80%
```

Maybe useful but incomplete.

Better alerts:

```text
primary unavailable > threshold
replication lag > business tolerance
majority write concern timeout rate > threshold
server selection timeout rate > threshold
outbox lag > SLA
dashboard projection lag > SLA
p99 case transition latency > SLO
retry rate spike
pool checkout timeout
```

Alerts should map to user/business impact.

---

## 46. HA Testing

Do not wait for production to learn failover behavior.

Test:

1. kill primary in staging,
2. observe election duration,
3. run write workload during failover,
4. verify retry behavior,
5. verify no duplicate side effects,
6. run transactions during failover,
7. observe unknown commit handling,
8. induce secondary lag,
9. test secondary reads stale behavior,
10. test app startup when no primary,
11. test backup restore,
12. test migration rollback.

For Java apps, specifically check:

```text
does thread pool pile up?
does pool recover?
are timeouts bounded?
do retries explode?
are commandIds reused on retry?
are background jobs backing off?
```

---

## 47. Chaos Drill: Primary Failover

Drill script:

```text
Given:
  staging replica set
  workload generator doing:
    case transitions
    worklist reads
    dashboard reads
    outbox processing

When:
  primary is stopped or isolated

Observe:
  errors during election
  retry attempts
  duplicate audit events
  command completion status
  outbox lag
  user-facing latency
  recovery time
```

Success criteria:

```text
no duplicate side effects
bounded error window
app recovers without restart
background jobs back off
metrics clearly show failover
```

---

## 48. Chaos Drill: Replication Lag

Simulate or induce lag through controlled means in staging.

Observe:

```text
secondary read freshness
dashboard staleness
majority write latency
change stream lag
application behavior
```

Success criteria:

```text
state-sensitive reads unaffected
stale-tolerant UI indicates freshness
background jobs do not worsen lag
alerts trigger before severe impact
```

---

## 49. HA Design Review Questions

Use this checklist during architecture review:

```text
[ ] What is the default read preference?
[ ] Which endpoints may read from secondary?
[ ] Which endpoints require read-your-write?
[ ] Which writes require majority?
[ ] What is the retry policy for each command?
[ ] Are writes idempotent?
[ ] How do we handle unknown commit result?
[ ] What happens during primary election?
[ ] What happens if secondary lag is 60 seconds?
[ ] What happens if majority writes timeout?
[ ] What happens if a bad migration is replicated?
[ ] What is RPO/RTO?
[ ] Has restore been tested?
[ ] Are dashboards/projections labelled with freshness?
[ ] Are background jobs throttled during lag?
[ ] Are metrics labelled by operation?
```

---

## 50. Common Misconceptions

### 50.1 “Replica Set Means No Downtime”

Not exactly.

There can be a failover window. Some operations may fail or retry.

### 50.2 “Secondary Reads Are Free Scaling”

No. They can be stale and can affect replication resources.

### 50.3 “Majority Write Means All Reads See It”

No. Read preference and read concern still matter.

### 50.4 “Replication Is Backup”

No. Replication copies bad writes too.

### 50.5 “Retry Solves Failover”

Retry without idempotency can duplicate side effects.

### 50.6 “Use Strongest Consistency Everywhere”

May harm performance/availability unnecessarily. Use deliberate consistency.

---

## 51. Senior-Level Heuristics

```text
If a read affects a state transition, read from primary or enforce via guarded write.

If user just wrote something, do not immediately refetch from a random secondary.

If stale read can create wrong business action, it is not stale-tolerant.

If write can be retried, make it idempotent.

If write concern timeout happens, assume uncertainty, not failure.

If replication lag rises, pause background jobs before blaming users.

If dashboards are approximate, show freshness.

If you have replica set but no backup restore drill, you do not have DR.

If global read preference is secondaryPreferred, audit every repository method.

If failover has never been tested, the retry design is speculative.
```

---

## 52. Practical Exercise

Design HA semantics for these endpoints:

```text
1. POST /cases/{id}/escalate
2. GET /cases/{id}
3. GET /cases/worklist
4. GET /dashboard/supervisor
5. GET /audit/cases/{id}
6. POST /imports/cases
7. GET /search/cases?q=...
8. GET /permissions/me
```

For each, decide:

1. read preference,
2. read concern,
3. write concern if write,
4. retry policy,
5. idempotency requirement,
6. stale tolerance,
7. failure response,
8. metrics.

Suggested direction:

```text
POST /cases/{id}/escalate:
  primary write
  majority if critical
  commandId required
  guarded state update
  bounded retry
  no external side effect inside transaction

GET /dashboard/supervisor:
  materialized summary
  secondary acceptable if stale labelled
  freshness timestamp required

GET /permissions/me:
  primary/authoritative
  not stale-tolerant

GET /search/cases:
  eventual consistency acceptable
  show index freshness if needed
```

---

## 53. Summary

Replication and high availability change how you think about MongoDB.

Key lessons:

1. Replica set provides failover, not zero-error magic.
2. Primary handles writes; secondary may lag.
3. Election creates transient failure windows.
4. Oplog drives replication.
5. Replication lag matters for stale reads and majority writes.
6. Read preference is a business consistency decision.
7. Write concern is a durability/latency trade-off.
8. Read concern controls visibility semantics, not node selection.
9. Majority write does not mean every secondary can immediately serve the data.
10. Retry must be bounded and idempotent.
11. Unknown commit result is uncertainty, not clean failure.
12. Secondary reads can help, but must be limited to stale-tolerant workloads.
13. Replication is not backup.
14. Disaster recovery requires tested restore.
15. Java apps must monitor topology, pool, retry, and operation-level errors.
16. HA must be tested through drills, not assumed.

The most important sentence:

> A production MongoDB application must treat failover, lag, stale reads, and uncertain writes as normal distributed-system states, not rare exceptions outside the design.

---

## 54. Bridge to Part 021

Part 021 will go deeper into horizontal scaling:

- why sharding exists,
- shard key as lifetime decision,
- `mongos`,
- config servers,
- chunks/ranges,
- balancer,
- range shard key,
- hashed shard key,
- compound shard key,
- cardinality/frequency/monotonicity,
- targeted query vs scatter-gather,
- zone sharding,
- resharding,
- sharding and transactions,
- sharding and unique constraints,
- shard key design for tenant/region/case/customer workloads.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-021.md
```

Judul berikutnya:

```text
Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking
```

---

## 55. Status Seri

Selesai sampai bagian ini:

```text
Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
Part 002 — BSON, JSON, Document Structure, and Type Semantics
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
Part 009 — Data Modelling II: Patterns for Real Systems
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
Part 014 — Concurrency Control and State Machines in MongoDB
Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure
Part 020 — Replication, High Availability, Read Scaling, and Failure Modes
```

Seri belum selesai. Masih lanjut ke Part 021 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-021.md">Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking ➡️</a>
</div>

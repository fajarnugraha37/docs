# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-029.md

# Part 029 — Observability and Operations: Metrics, Logs, Profiling, Slow Queries, Runbooks

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 029 dari 035  
> Fokus: observability, metrics, logs, slow query, profiler, query inventory, index inventory, Java driver monitoring, pool metrics, SLO, alerting, dashboards, tenant-level monitoring, projection lag, operational runbooks, and incident response  
> Target pembaca: Java software engineer / tech lead yang ingin mengoperasikan MongoDB-backed system dengan production discipline, bukan sekadar “cek CPU kalau lambat”

---

## 0. Posisi Part Ini Dalam Seri

Part 028 membahas testing. Testing membuktikan sistem benar sebelum dan saat deploy. Observability membuktikan sistem tetap sehat setelah deploy.

MongoDB production issue jarang datang dengan pesan jelas:

```text
Index X salah.
Query Y scan 50 juta docs.
Connection pool Z exhausted.
Tenant A membuat noisy neighbor.
Projection worker tertinggal 2 jam.
```

Yang terlihat biasanya:

```text
API lambat
timeout naik
CPU naik
dashboard stale
user bilang data tidak muncul
migration terasa berat
secondary lag
```

Observability membantu mengubah gejala menjadi diagnosis.

Kalimat inti:

> MongoDB operations yang baik bukan dimulai dari “database metrics banyak”, tetapi dari kemampuan menjawab: operasi aplikasi mana yang lambat, kenapa, siapa terdampak, dan apa tindakan aman berikutnya.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Mendesain observability layer untuk MongoDB-backed Java service.
2. Membedakan database metrics, driver metrics, application metrics, dan business metrics.
3. Menentukan SLO untuk operasi penting.
4. Menggunakan slow query logs/profiler/explain secara tepat.
5. Membuat query inventory dan index inventory.
6. Mendeteksi query targeting buruk.
7. Mengobservasi Java driver command events dan connection pool.
8. Mendeteksi pool exhaustion vs slow query vs application GC.
9. Mendesain logging query yang aman tanpa leak PII.
10. Mengukur projection/change stream/outbox lag.
11. Membuat alert yang actionable.
12. Membuat runbook untuk slow query, replication lag, pool exhaustion, retry storm, stale projection, and migration pressure.
13. Mendesain tenant-level observability untuk multi-tenant system.
14. Menghubungkan technical metrics dengan user/business impact.

---

## 2. Observability Mental Model

Observability bukan hanya monitoring dashboard.

Observability menjawab:

```text
What happened?
Where did it happen?
Who was affected?
Why did it happen?
Is it still happening?
What changed recently?
What is the safest next action?
```

Untuk MongoDB-backed service, kita butuh empat lapisan:

```text
Application layer:
  endpoint latency, errors, business operation metrics

Driver layer:
  command duration, pool checkout time, server selection, retries

Database layer:
  query latency, scanned/returned, locks, replication lag, CPU, memory, disk

Business/domain layer:
  command success, projection lag, tenant impact, audit divergence, retention progress
```

Jika hanya melihat database CPU, banyak masalah akan terlihat kabur.

---

## 3. Golden Signals

Golden signals untuk service:

```text
latency
traffic
errors
saturation
```

Untuk MongoDB-backed system:

### Latency

```text
HTTP latency
service method latency
repository method latency
MongoDB command duration
connection checkout latency
query execution latency
projection lag
```

### Traffic

```text
request QPS
Mongo command rate
read/write rate
outbox event rate
change stream event rate
tenant operation rate
```

### Errors

```text
HTTP 5xx/4xx
Mongo timeout
duplicate key
write concern error
server selection timeout
transaction retry failure
deserialization error
migration failure
projection dead-letter
```

### Saturation

```text
connection pool usage
thread pool usage
DB CPU
disk I/O
memory/cache pressure
replication lag
queue depth
outbox backlog
migration backlog
```

---

## 4. Metrics By Layer

### 4.1 Application Metrics

```text
case_transition_duration
case_transition_success_total
case_transition_conflict_total
case_search_duration
worklist_query_duration
dashboard_query_duration
retention_job_duration
migration_progress
```

### 4.2 Driver Metrics

```text
mongodb_command_duration
mongodb_command_failure_total
mongodb_pool_checkout_duration
mongodb_pool_checked_out_connections
mongodb_pool_wait_queue_size
mongodb_server_selection_failure_total
```

### 4.3 Database Metrics

```text
operation execution time
query scanned/returned ratio
index usage
connections
replication lag
oplog window
CPU/memory/disk
cache dirty/used
locks/queues depending engine/version
```

### 4.4 Business Metrics

```text
case_transition_success_rate
audit_insert_success_rate
outbox_lag_seconds
search_projection_lag_seconds
dashboard_freshness_seconds
tenant_error_rate
retention_overdue_records
legal_hold_count
```

Business metrics are often what wake you up.

---

## 5. Operation Labels

Do not only measure:

```text
mongodb.command.duration{command="find"}
```

Add operation-level labels at application boundary:

```text
operation="case.worklist.findOpenByAssignee"
operation="case.transition.escalate"
operation="audit.findByCase"
operation="retention.findEligible"
operation="search.case.keyword"
```

Why?

A slow `find` is not actionable. A slow `case.worklist.findOpenByAssignee` is actionable.

Example structured metric:

```text
mongo_repository_duration_seconds{
  operation="case.worklist.findOpenByAssignee",
  collection="cases",
  tenantTier="shared",
  result="success"
}
```

Be careful with high cardinality labels like raw tenantId if many tenants. Use top-N or controlled labels.

---

## 6. Tracing

Distributed tracing helps connect:

```text
HTTP request
  -> service validation
  -> repository query
  -> MongoDB command
  -> outbox insert
  -> downstream publish
```

Trace attributes:

```text
operation name
collection
db.system=mongodb
query shape hash
tenant tier
command type
result count
error class
```

Avoid putting raw query values or sensitive document fields into trace attributes.

Use query shape hash:

```text
tenantId,status,assigneeId,dueAt_sort
```

not:

```text
tenantId=tenant-a&assigneeId=u123
```

unless privacy/cardinality rules permit.

---

## 7. Safe Logging

Bad log:

```text
slow query: {"tenantId":"tenant-a","nationalId":"123456789","notes":"..."}
```

Good log:

```text
slow mongo operation
operation=case.search.keyword
collection=case_search_documents
queryShape=tenantId+auth+text
durationMs=820
resultCount=20
limit=20
tenantTier=shared
correlationId=...
```

Rules:

```text
log query shape, not sensitive values
log counts and durations
log operation name
log correlation id
sanitize connection strings
avoid full document logs
avoid free text field logs
```

---

## 8. Slow Query Sources

MongoDB has multiple ways to investigate slow operations:

- Database Profiler.
- Slow query logs.
- `$currentOp`.
- `explain()`.
- Atlas Query Profiler / Performance Advisor / Query Targeting metrics.
- Application metrics/traces.

MongoDB documentation describes the Database Profiler as a tool to identify slow queries and notes that enabling profiling can affect performance/disk usage and expose query data. citeturn730533search0

Therefore:

```text
use profiler deliberately
protect profiler data
avoid exposing sensitive query payloads
```

---

## 9. Database Profiler

Profiler records operations based on profiling level/threshold.

Use cases:

```text
temporary investigation
slow query analysis
query shape discovery
index tuning
regression diagnosis
```

Risks:

```text
performance overhead
storage usage
sensitive query data exposure
noise if enabled too broadly
```

Guideline:

```text
Enable only as needed, with threshold/sampling strategy, and treat profiler output as sensitive.
```

In managed Atlas, Query Profiler and Performance Advisor may provide safer operational workflow depending cluster tier and configuration. Atlas documentation describes Query Profiler as exposing slow-running queries and key performance statistics, while Performance Advisor monitors slow queries and suggests indexes. citeturn730533search5turn730533search4

---

## 10. `$currentOp`

`$currentOp` shows currently running operations.

Use during incident:

```javascript
db.getSiblingDB("admin").aggregate([
  { $currentOp: { allUsers: true } },
  { $match: { secs_running: { $gt: 2 } } },
  { $sort: { secs_running: -1 } }
])
```

MongoDB docs show using `$currentOp` to retrieve current operations and inspect plan summaries like `IXSCAN` or `COLLSCAN` when diagnosing slow operations. citeturn730533search7

Use for:

- long-running operations,
- stuck queries,
- collection scans,
- migration jobs,
- large aggregations,
- lock/contention symptoms.

Do not run operational commands casually without access control.

---

## 11. `explain()`

`explain()` helps answer:

```text
which plan?
which index?
how many keys examined?
how many docs examined?
was sort supported?
was there collection scan?
```

Workflow:

```text
capture query shape
run explain with representative parameters
inspect winning plan
inspect keys/docs examined
inspect sort stages
compare with expected index
test candidate index
measure again
```

Do not rely on explain with toy data only.

---

## 12. Query Targeting

Important metric:

```text
scanned / returned
docsExamined / docsReturned
keysExamined / docsReturned
```

Bad:

```text
1,000,000 docs examined
50 returned
```

Atlas docs describe Query Targeting metrics and the Query Profiler as ways to identify high ratios of scanned objects to returned documents. citeturn730533search6

Use alerts for:

```text
query targeting ratio high
COLLSCAN in hot path
docs examined sudden spike
```

But tune to workload. Some batch/reporting scans may be expected.

---

## 13. Query Inventory

Create inventory of important query shapes.

Fields:

```text
operation name
collection
filter fields
sort fields
projection fields
limit
pagination strategy
expected index
expected result count
expected docs examined
SLO
owner
```

Example:

```text
operation:
  case.worklist.findOpenByAssignee

collection:
  cases

filter:
  tenantId, status, assigneeId

sort:
  dueAt ASC, _id ASC

projection:
  caseNumber, title, priority, dueAt

limit:
  50

index:
  { tenantId: 1, status: 1, assigneeId: 1, dueAt: 1, _id: 1 }

SLO:
  p95 < 100ms
```

Query inventory prevents accidental query sprawl.

---

## 14. Index Inventory

Maintain:

```text
index name
collection
fields
unique/partial/sparse/TTL
use case
owner
created date
usage evidence
write cost concern
drop candidate?
```

Why?

Indexes accumulate.

Old indexes increase:

- storage,
- memory pressure,
- write amplification,
- operational complexity.

Index inventory helps answer:

```text
why does this index exist?
who owns it?
can we drop it?
what query breaks if dropped?
```

---

## 15. Slow Query Log Anatomy

Useful fields:

```text
operation
namespace
command type
filter shape
sort
projection
plan summary
keys examined
docs examined
docs returned
duration
locks/waits if available
remote client
appName
```

Application should add context:

```text
endpoint
repository method
tenant tier
correlation id
user action
```

Database slow log alone may not know business operation.

---

## 16. Java Driver Command Monitoring

MongoDB Java driver supports command monitoring and connection pool events. Official Java driver docs describe command monitoring and connection pool monitoring; connection pool events relate to the pool of TCP connections the driver maintains to a MongoDB instance/deployment. citeturn730533search2

Use command monitoring to capture:

```text
command started
command succeeded
command failed
duration
command name
database
collection if available
request id
connection/server
```

Do not log full command payload by default.

---

## 17. Java Driver Pool Monitoring

Connection pool metrics answer:

```text
Are requests waiting for MongoDB connections?
Is pool too small?
Are operations holding connections too long?
Did failover cause pool churn?
Are connections being created/destroyed frequently?
```

Measure:

```text
checked-out connections
available connections
wait queue size
checkout duration
checkout failures/timeouts
connection created/closed
pool cleared
```

If API latency high but command duration low and checkout wait high, issue is pool/concurrency.

If command duration high, issue is query/database/downstream.

---

## 18. Pool Exhaustion Symptoms

Symptoms:

```text
connection checkout timeout
request p99 spikes
many threads blocked
Mongo command rate maybe flat
DB CPU not necessarily high
```

Causes:

- slow queries holding connections,
- pool too small,
- too much app concurrency,
- transaction holds connection/session,
- cursor not consumed/closed,
- downstream slow inside DB operation flow,
- failover clearing pools,
- leak/long-running cursor.

Do not blindly increase pool.

Diagnosis:

```text
checkout time high?
command duration high?
active threads high?
DB saturated?
cursor usage correct?
```

---

## 19. Cursor Observability

Large queries/cursors can hold resources.

Watch:

- unclosed cursors,
- long-running cursors,
- huge result batches,
- batch size,
- export jobs,
- streaming endpoints.

Application rules:

```text
always close cursor
limit result size
use batch processing
separate export path
avoid loading all results into memory
```

---

## 20. Application vs Database Latency

Compare:

```text
HTTP duration
service duration
repository duration
Mongo command duration
connection checkout duration
mapping duration
```

Cases:

### DB slow

```text
command duration high
docs examined high
```

### Pool bottleneck

```text
checkout duration high
command duration normal
```

### Java mapping/GC

```text
command duration low
repository/service duration high
allocation/GC high
```

### Network/serialization

```text
large result bytes
command duration includes transfer maybe high
API response encoding high
```

Need separate timers.

---

## 21. Mapping/Deserialization Metrics

MongoDB query may be fast but Java mapping slow.

Track:

```text
result count
result bytes if available
mapping duration
DTO size
GC allocation
heap pressure
```

Symptoms:

```text
large documents
full aggregate returned for list page
projection missing
GC pause
```

Fix:

- projection,
- smaller DTO,
- limit page size,
- split document,
- streaming batch carefully.

---

## 22. Business SLOs

Define SLO per operation.

Example:

```text
case.transition.escalate:
  p95 < 150ms
  p99 < 700ms
  success rate > 99.9%
  duplicate side effect = 0
  audit divergence = 0

case.worklist:
  p95 < 200ms
  p99 < 1s

case.search.keyword:
  p95 < 500ms

dashboard.summary:
  freshness < 30s

search.projection:
  lag < 60s

outbox.dispatch:
  lag < 30s
```

SLO drives alerts.

Do not alert only on CPU.

---

## 23. Alert Design

Good alert:

```text
case_transition_error_rate > threshold
and p95 latency > SLO
```

or:

```text
search_projection_lag_seconds > 60 for 10 minutes
```

Bad alert:

```text
one slow query occurred
```

Too noisy.

Alert should be:

- actionable,
- tied to user/business impact,
- have runbook,
- avoid flapping,
- include context.

---

## 24. MongoDB Alerts To Consider

Cluster:

```text
primary unavailable
replication lag high
oplog window low
disk space low
disk I/O saturation
CPU sustained high
memory/cache pressure
connection count high
query targeting ratio high
index build failure
backup failure
```

Application:

```text
server selection timeout
connection checkout timeout
command failure rate
duplicate key unexpected spike
write concern timeout
transaction retry exhaustion
pool cleared frequently
```

Domain:

```text
audit insert failure
outbox lag high
projection lag high
retention overdue
migration stalled
tenant error spike
```

---

## 25. Tenant-Level Observability

For multi-tenant systems:

```text
latency by tenant/tier
error rate by tenant/tier
query volume by tenant/tier
storage by tenant
outbox lag by tenant
search lag by tenant
retention backlog by tenant
migration progress by tenant
```

But avoid unbounded metric label cardinality.

Strategies:

- label tenant tier,
- top-N tenant dashboards,
- logs with tenantId,
- exemplars/traces,
- separate metrics for premium tenants,
- sampled high-cardinality analytics.

Noisy neighbor diagnosis requires tenant-level visibility.

---

## 26. Projection Lag

For async projections:

```text
case_search_documents.projectedAt
case_worklist_items.projectedAt
dashboard_summaries.updatedAt
```

Metrics:

```text
now - latestProcessedEventTime
now - projection.updatedAt for active tenants
outbox pending age
change stream lag
dead-letter count
```

Alert when lag exceeds business tolerance.

Projection lag is user-visible consistency issue.

---

## 27. Outbox Observability

Outbox metrics:

```text
pending count
oldest pending age
processing count
failed count
dead-letter count
publish latency
attempt count
events/sec
lease expired count
```

Runbook if lag high:

```text
publisher down?
broker down?
poison event?
DB slow?
network issue?
tenant spike?
```

Outbox is critical integration boundary.

---

## 28. Migration Observability

Migration metrics:

```text
migration status
documents scanned
documents modified
documents skipped
documents failed
batch duration
current checkpoint
per-tenant progress
estimated remaining
replication lag during migration
application latency impact
```

Alert:

```text
migration stalled
error rate high
replication lag above threshold
p99 app latency impacted
```

Migration runner should have pause/resume.

---

## 29. Retention Observability

Metrics:

```text
eligible records
processed records
deleted records
archived records
skipped legal hold
failed records
oldest overdue record
delete batch duration
archive verification failure
```

Alert:

```text
retention overdue beyond policy
legal hold violation attempt
archive manifest failure
delete job causing replication lag
```

Retention failure can be compliance issue.

---

## 30. Security Observability

Security-relevant metrics/logs:

```text
failed authentication spikes
unexpected DB user access
support access events
export events
admin commands
collection drop attempts
large reads by support account
cross-tenant query anomaly
audit modification attempt
secret rotation failure
```

Security logs must be protected.

---

## 31. Query Shape Hashing

To avoid logging sensitive values, compute query shape:

```text
collection=cases
filterFields=tenantId,status,assigneeId
sortFields=dueAt,_id
projectionFields=caseNumber,title,status,dueAt
```

Hash:

```text
shapeHash=sha256("cases|tenantId,status,assigneeId|sort:dueAt,_id|projection:...")
```

Use in metrics/logs:

```text
query_shape_hash
query_shape_name if known
```

This groups similar queries without exposing values.

---

## 32. Query Budget

For hot operations, define budgets:

```text
max limit
max docs examined
max duration
max result bytes
max aggregation memory/disk spill allowed
```

Example:

```text
case.worklist:
  limit <= 50
  docsExamined <= 100 typical
  p95 <= 200ms
```

If query exceeds, log structured warning.

Application can detect result size/pagination abuse before database.

---

## 33. Slow Query Triage Runbook

When API is slow:

```text
1. Identify operation/endpoint.
2. Check app latency breakdown.
3. Check Mongo command duration vs pool checkout.
4. Check slow query/profiler for same operation.
5. Capture query shape.
6. Run explain with representative params.
7. Check docs/keys examined and index.
8. Check result size/projection.
9. Check tenant skew.
10. Check recent deploy/migration/index change.
11. Decide fix: query constraint, index, projection, data model, materialization, throttling.
```

Do not start by adding random index.

---

## 34. Pool Exhaustion Runbook

Symptoms:

```text
connection checkout timeout
pool wait high
request threads blocked
```

Steps:

```text
1. Check checkout duration and wait queue.
2. Check command duration.
3. Identify top operations holding connections.
4. Check cursor leaks/long exports.
5. Check app concurrency/thread pool.
6. Check DB saturation.
7. Temporarily throttle expensive operations.
8. Consider pool tuning only after root cause.
```

If slow query is root cause, bigger pool may worsen DB pressure.

---

## 35. Replication Lag Runbook

Symptoms:

```text
secondary lag high
majority writes slow
change streams delayed
stale secondary reads
```

Steps:

```text
1. Identify lagging node/shard.
2. Check write spikes.
3. Check migration/delete/TTL/archive jobs.
4. Check secondary CPU/disk/network.
5. Check heavy secondary reads.
6. Pause/throttle background jobs.
7. Route stale-sensitive reads to primary.
8. Monitor catch-up.
```

---

## 36. Retry Storm Runbook

Symptoms:

```text
timeouts
retry count spike
traffic amplification
DB saturation
pool exhaustion
```

Steps:

```text
1. Check retry metrics by operation.
2. Identify triggering error.
3. Disable/reduce retries for non-critical operations if configurable.
4. Enforce backpressure.
5. Open circuit breaker for expensive paths.
6. Pause background jobs.
7. Verify idempotency for retried writes.
8. Communicate degraded mode.
```

Retry should protect transient errors, not amplify outage.

---

## 37. Projection Drift Runbook

Symptoms:

```text
search shows wrong status
worklist stale
dashboard count wrong
projection lag normal but data wrong
```

Steps:

```text
1. Identify affected projection and tenant.
2. Compare source vs projection.
3. Check consumer errors/dead letters.
4. Check recent schema change.
5. Disable unsafe search if security issue.
6. Rebuild affected projection.
7. Add regression test.
8. Audit exposure if sensitive.
```

Projection bug can become security incident.

---

## 38. High CPU Runbook

High CPU can mean:

- inefficient queries,
- too many operations,
- aggregation/sort,
- index build,
- compression/encryption overhead,
- connection churn,
- Java app load not DB maybe.

Steps:

```text
1. Check top operations.
2. Check query targeting.
3. Check QPS spike.
4. Check recent deploy.
5. Check index build/migration.
6. Check tenant spike.
7. Check CPU per node/shard.
8. Throttle noisy workload.
```

CPU alone does not diagnose.

---

## 39. Disk Space Runbook

Disk pressure sources:

- data growth,
- index growth,
- profiler output,
- logs,
- backups/snapshots,
- large migration temp data,
- TTL not keeping up,
- archive delay.

Steps:

```text
1. Identify fastest-growing namespaces.
2. Check indexes size.
3. Check profiler/log settings.
4. Check retention job.
5. Check recent bulk import.
6. Add capacity or delete/archive safely.
7. Avoid emergency broad delete without plan.
```

---

## 40. Dashboard Design

Create dashboards by audience.

### Application dashboard

```text
endpoint latency
operation latency
Mongo command latency
pool checkout
errors
retries
outbox/projection lag
```

### Database dashboard

```text
CPU/memory/disk
ops/sec
connections
replication lag
query targeting
slow ops
index usage
```

### Business dashboard

```text
case transition success
worklist freshness
dashboard freshness
tenant health
retention backlog
audit health
```

### Migration dashboard

```text
progress
batch duration
failures
lag impact
pause state
```

---

## 41. Log Correlation

Every operation should have correlation ID.

Flow:

```text
HTTP request correlationId
  -> service logs
  -> Mongo operation label/trace
  -> audit/outbox event
  -> downstream consumer logs
```

Audit event should include commandId/correlationId.

When user reports issue, you can trace across system.

---

## 42. AppName In MongoDB Connections

Set application name in driver configuration.

Benefit:

- identify service in DB logs/profiler,
- separate case-service vs reporting vs migration,
- incident triage.

Example:

```java
MongoClientSettings.builder()
    .applicationName("case-command-service-prod")
```

---

## 43. Operation Naming Convention

Use stable operation names:

```text
case.command.escalate
case.query.findDetail
case.query.worklist
case.audit.findByCase
case.search.keyword
outbox.claim
retention.findEligible
migration.caseOwnerV2.batch
```

Do not use raw method names if they change often.

---

## 44. Sampling

Full instrumentation can be expensive.

Use:

```text
always count errors
always measure duration histogram
sample query details
log slow operations above threshold
trace sampled requests
force trace for debug header/admin
```

For sensitive systems, ensure debug tracing cannot leak PII.

---

## 45. Profiler Data Security

Profiler may contain query details.

Treat as sensitive.

Controls:

```text
limited access
short retention
redaction if available
avoid profiling broad sensitive queries longer than needed
audit profiler access
```

MongoDB docs warn profiler output can expose unencrypted query data. citeturn730533search0

---

## 46. Index Usage Review

Regular review:

```text
unused indexes
overlapping indexes
large indexes
write-heavy indexes
index build failures
query patterns without indexes
```

Do not auto-drop without safety.

Process:

```text
identify candidate
map to query inventory
hide/test if supported
observe
drop in maintenance window
monitor
```

---

## 47. Query Review Cadence

For critical systems:

```text
weekly slow query review
monthly index inventory review
after every major release
after data growth milestone
after incident
before large tenant onboarding
```

Query performance changes as data distribution changes.

---

## 48. Capacity Observability

Track:

```text
data size growth
index size growth
hot collection growth
document p95 size
tenant storage growth
audit volume
outbox volume
working set estimate
disk I/O trend
backup duration
restore duration
```

Capacity issue is easier before disk full alert.

---

## 49. Document Size Monitoring

Large documents cause p99 issues.

Track p95/p99 document size for key collections.

Methods:

- periodic sampling,
- aggregation with `$bsonSize` where appropriate,
- application-level serialized size,
- outlier reports.

Alert if:

```text
case document p99 > threshold
audit embedded array grows
worklist projection too large
```

---

## 50. Cursor/Export Observability

Exports can hurt production.

Metrics:

```text
active exports
export duration
documents exported
bytes exported
cursor age
tenant export QPS
export failure
```

Controls:

- async job,
- rate limit,
- off-peak,
- separate read preference if safe,
- no unbounded memory.

---

## 51. Runbook Quality

A good runbook includes:

```text
symptoms
likely causes
dashboards to check
queries/commands to run
safe mitigations
dangerous actions to avoid
escalation path
post-incident checks
```

Bad runbook:

```text
check database
restart service
```

Runbooks should be tested in drills.

---

## 52. Post-Incident Review

After MongoDB incident:

```text
what was user impact?
which operation?
which tenant?
which query/index?
what changed?
why alert fired late/early?
what metric was missing?
what runbook step failed?
what test could have caught it?
what design needs change?
```

Add:

- regression test,
- dashboard panel,
- alert,
- query inventory update,
- index owner,
- runbook improvement.

---

## 53. Practical Exercise

Design observability for regulatory case platform.

Critical flows:

```text
case transition
worklist query
case search
audit view
outbox dispatch
search projection
dashboard summary
retention deletion
bulk import
schema migration
```

For each, define:

1. SLO,
2. application metrics,
3. MongoDB metrics,
4. logs,
5. alerts,
6. dashboard panels,
7. runbook.

Suggested direction:

```text
case transition:
  p95/p99, success/error/conflict, command duration, transaction retry, audit/outbox insert

worklist:
  query latency, docs examined, result count, pool checkout, tenant skew

search:
  latency, zero results, index lag, authorization filter errors

outbox:
  pending count, oldest pending age, failures, dead letters

retention:
  eligible overdue, legal hold skipped, deletion manifest failures

migration:
  per-tenant progress, lag impact, batch failures
```

---

## 54. Senior-Level Heuristics

```text
If you cannot name the slow operation, you cannot fix it safely.

If you only monitor database CPU, you will miss query shape problems.

If pool checkout is high but command duration low, look at concurrency/pool.

If docs examined dwarfs docs returned, look at query/index.

If search is stale, check projection lag before blaming query.

If tenant A is noisy, global averages hide it.

If profiler is enabled, treat output as sensitive data.

If alert has no runbook, it is only noise.

If migration has no dashboard, it is not production-ready.

If backup/restore duration is unknown, DR is unproven.
```

---

## 55. Summary

Observability makes MongoDB production behavior understandable.

Key lessons:

1. Monitor application, driver, database, and business layers.
2. Operation labels matter more than generic command names.
3. Query shape and index ownership should be inventoried.
4. Slow query diagnosis needs profiler/logs, explain, and app context.
5. Query targeting ratio reveals inefficient scans.
6. Java driver monitoring helps distinguish pool wait from query latency.
7. Projection, outbox, migration, and retention need their own metrics.
8. Tenant-level observability is required for multi-tenant fairness.
9. Logs must be structured and sanitized.
10. Alerts should map to SLO and have runbooks.
11. Profiler data can expose sensitive queries; protect it.
12. Capacity trends must include data, indexes, document size, and tenant growth.
13. Incident review should improve tests, dashboards, runbooks, and design.
14. Runbooks should be concrete and rehearsed.
15. Observability is part of architecture, not decoration.

The most important sentence:

> Production MongoDB excellence is the ability to connect a user-visible symptom to a specific operation, query shape, resource bottleneck, tenant, and safe remediation path.

---

## 56. Bridge to Part 030

Part 030 will focus on:

- backup types,
- point-in-time recovery,
- restore drills,
- RPO/RTO,
- retention,
- legal hold,
- disaster recovery,
- regional failure,
- accidental deletion,
- logical corruption,
- tenant-level restore,
- archive restore,
- backup security,
- restore runbooks,
- Java/application responsibilities during DR.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-030.md
```

Judul berikutnya:

```text
Part 030 — Backup, Restore, Disaster Recovery, Retention, and Compliance
```

---

## 57. Status Seri

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
Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking
Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries
Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets
Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka
Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections
Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search
Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes
Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing
Part 029 — Observability and Operations: Metrics, Logs, Profiling, Slow Queries, Runbooks
```

Seri belum selesai. Masih lanjut ke Part 030 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-030.md">Part 030 — Backup, Restore, Disaster Recovery, Retention, and Compliance ➡️</a>
</div>

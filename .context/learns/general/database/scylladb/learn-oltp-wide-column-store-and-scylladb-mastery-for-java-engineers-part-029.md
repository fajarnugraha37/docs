# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-029.md

# Part 029 — Observability: Metrics, Logs, Tracing, Dashboards, Alerts, SLOs, Driver Metrics, Table/Tenant-Level Monitoring, dan p99 Incident Diagnosis

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `029`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: observability end-to-end untuk ScyllaDB-backed Java services: SLO, RED/USE metrics, Java driver metrics, repository operation metrics, table-level metrics, tenant-level observability, logs, tracing, dashboards, alerting, p99 debugging, noisy neighbor diagnosis, dan incident workflow.

---

## 0. Posisi Part Ini dalam Seri

Part 026–028 membahas operations:

```text
capacity planning
repair
node lifecycle
backup
restore
DR
```

Part ini membahas bagaimana kita mengetahui sistem sehat atau sakit.

Observability menjawab:

```text
Apakah user mengalami latency?
Operasi apa yang lambat?
Table mana yang bermasalah?
Tenant mana yang menyebabkan load?
Apakah bottleneck di Java client, coordinator, replica, disk, compaction, atau network?
Apakah retry memperburuk keadaan?
Apakah derived view stale?
Apakah backfill mengganggu foreground traffic?
Apakah p99 naik karena satu hot partition?
```

Tanpa observability, engineer hanya menebak.

---

## 1. Observability Is a Product Feature

Database observability bukan “ops nice-to-have”.

Untuk sistem OLTP production:

```text
no observability = no reliability
```

User tidak peduli apakah masalah di:

- Java driver,
- ScyllaDB node,
- compaction,
- hot tenant,
- network,
- bad query,
- retry storm,
- stale projection.

User hanya merasakan:

```text
slow
error
wrong data
missing data
```

Observability harus menghubungkan user symptom ke technical cause.

---

## 2. Three Layers of Observability

### 2.1 Application Layer

```text
HTTP/gRPC endpoint
service method
repository operation
business command
tenant/user context
```

### 2.2 Client/Driver Layer

```text
CqlSession
connection pool
request latency
timeouts
retries
speculative execution
node chosen
local DC
```

### 2.3 Database Layer

```text
node
shard
table
keyspace
compaction
cache
disk
network
repair
streaming
```

Need correlation across all three.

---

## 3. Golden Questions

For every incident, observability should answer:

```text
1. Which user-facing operation is affected?
2. Which repository operation/table is affected?
3. Which tenants are affected or causing load?
4. Is it read or write?
5. Is it p50, p95, p99, or errors?
6. Is it timeout, unavailable, overloaded, conflict, or stale data?
7. Is fanout involved?
8. Is retry/speculative execution involved?
9. Is cluster/node/shard/table unhealthy?
10. Did a deploy/backfill/repair/upgrade happen?
```

If dashboard cannot answer these, improve it.

---

## 4. SLI and SLO

### 4.1 SLI

Service Level Indicator: metric representing service quality.

Examples:

```text
case detail read latency
case transition success rate
notification feed freshness
assignee queue p99
LWT conflict rate
derived view lag
```

### 4.2 SLO

Service Level Objective: target.

Example:

```text
99% of case detail reads under 250ms over 30 days
99.9% of case transition commands complete or return known pending within 1s
derived assignee queue lag < 30s for 99% of updates
```

Use SLO to drive alerts, not random CPU thresholds alone.

---

## 5. RED Metrics for Services

RED:

```text
Rate
Errors
Duration
```

For each user-facing endpoint:

```text
request rate
error rate by category
latency histogram
```

But for ScyllaDB services, add:

```text
DB operation count per request
fanout count
retry count
rows returned
stale filtered count
tenant_id/tier sampled
```

---

## 6. USE Metrics for Infrastructure

USE:

```text
Utilization
Saturation
Errors
```

For ScyllaDB nodes:

```text
CPU utilization/reactor utilization
disk utilization and IO latency
network utilization
request queues/saturation
timeouts/errors
```

USE helps identify resource bottlenecks.

RED tells user impact.

Need both.

---

## 7. Operation-Level Metrics

Every repository method should emit metrics.

Example operation:

```text
CaseCurrentRepository.findAuthoritativeByTenantAndCase
```

Metrics:

```text
latency histogram
success count
not_found count
timeout count
unavailable count
overloaded count
retry attempts
speculative attempts
rows returned
payload bytes estimated
execution profile
consistency level
table
```

Labels should be low-cardinality:

```text
operation
table
profile
result
exception_category
tenant_tier
```

Avoid raw `case_id` as label.

---

## 8. Why Table-Level Labels Matter

If app emits only endpoint metrics:

```text
GET /cases/{id} slow
```

you do not know which table caused it.

Endpoint may call:

- case_current_by_id,
- case_events_by_case_version_bucket,
- tasks_by_case,
- attachments_by_case,
- open_cases_by_assignee.

Repository metrics map symptoms to table/query.

---

## 9. Operation Naming

Use stable names:

```text
case_current.find_by_id.authoritative
case_current.transition_lwt
case_events.find_latest_by_case_bucket
open_cases.find_by_assignee_day_bucket
notifications.find_feed_by_user_day
backfill.open_cases_v2.write
```

Avoid dynamic operation names:

```text
find_by_case_123
```

Stable operation names enable dashboards and alerts.

---

## 10. Latency Histograms

Use histograms, not only averages.

Track:

```text
p50
p90
p95
p99
p999
max maybe
```

Averages hide tail.

For distributed DB, p99 is critical because:

- one slow replica,
- one hot partition,
- one large page,
- one GC pause,
- one fanout subquery.

---

## 11. Error Taxonomy Metrics

Do not emit only:

```text
db_error_total
```

Categorize:

```text
read_timeout
write_timeout
timeout_unknown
unavailable
overloaded
no_node_available
all_nodes_failed
invalid_query
auth_error
codec_error
schema_error
lwt_conflict
not_found
stale_filtered
```

This maps to action.

`invalid_query` means bug.

`overloaded` means capacity/load issue.

`lwt_conflict` may be normal business contention.

---

## 12. Timeout Unknown Metric

For writes/LWT:

```text
timeout != failed
```

Track:

```text
timeout_unknown_total
timeout_unknown_resolved_success
timeout_unknown_resolved_conflict
timeout_unknown_pending
```

This prevents false user-facing semantics.

---

## 13. LWT Metrics

For LWT operations:

```text
attempt count
applied=true
applied=false
timeout
unknown outcome
contention key hash sampled
latency p99
```

High applied=false can mean:

- normal contention,
- duplicate command,
- stale UI version,
- bot/retry issue,
- concurrent workflow problem.

---

## 14. Retry Metrics

Track:

```text
retry_attempts_total
retry_success_total
retry_exhausted_total
retry_by_exception
retry_latency_added
retry_budget_rejected
```

Retries are load.

High retry success may look good, but it still increases latency and cluster traffic.

---

## 15. Speculative Execution Metrics

Track:

```text
speculative_started
speculative_won
speculative_lost
extra_requests
profiles_using_speculation
```

Speculative execution should be justified by p99 improvement.

If speculative_started high but won low:

```text
wasted load
```

Disable/tune.

---

## 16. Fanout Metrics

For fanout query:

```text
fanout_count
subquery_latency
slowest_subquery_latency
rows_fetched
rows_returned
overfetch_ratio
partial_failure_count
merge_latency
stale_filtered_count
```

Without this, fanout p99 is opaque.

---

## 17. Paging Metrics

Track:

```text
page_size
pages_fetched
rows_per_page
driver_paging_state_used
api_cursor_version
cursor_decode_error
limit
```

Red flags:

- pages_fetched too high for endpoint,
- page_size huge,
- cursor errors after migration,
- rows fetched far greater than returned.

---

## 18. Payload Metrics

Track estimated payload bytes:

```text
request_payload_bytes
result_payload_bytes
row_payload_bytes
blob/reference size
```

Large payload causes:

- network cost,
- Java heap pressure,
- GC,
- compaction/repair/backup cost.

Payload growth often causes performance regression.

---

## 19. Tenant-Level Observability

Multi-tenant systems need tenant insight.

Track top-N or sampled:

```text
tenant read QPS
tenant write QPS
tenant p99
tenant timeout
tenant storage
tenant backfill/export activity
tenant quota rejects
tenant hot key samples
```

Avoid high-cardinality metrics explosion.

Approaches:

- top-N dashboards,
- tenant tier labels,
- sampled structured logs,
- per-mega-tenant dedicated metrics,
- hash buckets.

---

## 20. Hot Key Observability

Raw partition keys may be sensitive.

Use:

```text
partition_key_hash
tenant_id if allowed
operation
table
bucket
sampled count
```

Hot key detection helps distinguish:

```text
hot tenant
```

from:

```text
hot partition
```

They require different fixes.

---

## 21. ScyllaDB Server Metrics

Important categories:

```text
read/write latency
timeouts
unavailable
overload
cache hit rate
SSTable count
compaction pending
disk usage
disk IO latency
network throughput
CPU/reactor utilization
memory
tombstone warnings
large partition warnings
repair status
streaming status
node status
shard utilization
```

Server metrics show resource state.

Application metrics show business/query source.

---

## 22. Node vs Shard Metrics

Cluster average can hide shard hotspots.

Need inspect:

```text
per-node
per-shard
per-table
```

A single hot shard can cause p99 for one workload while cluster CPU average looks fine.

Shard-per-core architecture makes shard-level visibility valuable.

---

## 23. Table-Level Metrics

Per table:

```text
read QPS
write QPS
read latency
write latency
disk usage
SSTables
compaction
tombstones
large partitions
cache hit
```

A derived table with tombstones can hurt one endpoint.

A source event table with large partitions can hurt another.

Table-level metrics connect to repository names.

---

## 24. Compaction Metrics

Watch:

```text
pending compactions
compaction throughput
SSTable count
disk usage
read amplification
tombstone droppable ratio
```

Compaction backlog often explains:

- read p99 increase,
- disk growth,
- tombstone persistence,
- post-backfill degradation.

---

## 25. Repair Metrics

Watch:

```text
last successful repair
repair duration
repair progress
repair failures
repair bandwidth
repair overlap with traffic
```

Repair metrics connect to tombstone safety.

If repair fails repeatedly, gc_grace assumptions may be invalid.

---

## 26. Backup Metrics

From part 028:

```text
last backup age
backup success
backup size
backup duration
checksum errors
restore drill age
```

Alert if backup stale.

Reliability includes recovery.

---

## 27. Logs: Structured, Not String Soup

Use structured logs:

```json
{
  "event": "scylla_query_slow",
  "operation": "open_cases.find_by_assignee_day_bucket",
  "table": "open_cases_by_assignee_day_bucket",
  "duration_ms": 184,
  "profile": "derived-read-fast",
  "consistency": "LOCAL_ONE",
  "tenant_tier": "enterprise",
  "tenant_id": "redacted-or-allowed",
  "partition_key_hash": "a93f...",
  "bucket_day": "2026-06-21",
  "bucket_id": 7,
  "rows_returned": 50,
  "pages": 1,
  "retry_attempts": 0
}
```

Structured logs enable search and incident analysis.

---

## 28. Slow Query Logs in Application

Application should log slow repository operations.

Fields:

```text
operation
table
duration
profile
CL
rows
pages
fanout
tenant/tier
partition_key_hash
bucket
payload_bytes
retry_count
exception_category
request_id/trace_id
```

Do not log raw CQL values with PII.

---

## 29. Error Logs

Error logs should include:

- exception category,
- operation,
- table,
- profile,
- CL,
- retry attempts,
- local DC,
- node info if available,
- tenant/tier,
- trace ID.

Avoid:

```text
full row payload
raw secrets
large stack traces for expected conflicts
```

LWT conflict is often not error log; it is business metric.

---

## 30. Tracing

Distributed tracing connects:

```text
HTTP request
service method
repository query
fanout subquery
external system
```

Trace attributes:

```text
db.system=scylla
db.operation=select/insert/update
db.table
scylla.profile
scylla.consistency
scylla.page_size
scylla.rows
tenant.tier
```

Do not put PII in trace attributes.

---

## 31. Trace Sampling

Do not trace everything at high volume.

Use:

- head-based sampling,
- tail-based sampling for slow/error requests,
- per-tenant sampling for mega tenants,
- always sample timeout_unknown,
- always sample schema/codec errors.

Tracing is expensive.

---

## 32. Fanout Tracing

For fanout query, create subspans:

```text
open_cases.bucket[0]
open_cases.bucket[1]
...
```

But if bucket_count high, avoid too many spans.

Alternative:

```text
aggregate fanout span with count and slowest bucket
```

Balance visibility and overhead.

---

## 33. Dashboards

Minimum dashboards:

```text
1. Service SLO dashboard
2. Repository operation dashboard
3. Driver/client dashboard
4. ScyllaDB cluster dashboard
5. Table/keyspace dashboard
6. Tenant/noisy neighbor dashboard
7. Backfill/export dashboard
8. Repair/backup dashboard
9. Multi-region dashboard if applicable
```

Dashboards should answer operational questions, not just display graphs.

---

## 34. Service SLO Dashboard

Show:

```text
endpoint latency p50/p95/p99
error rate
traffic rate
SLO burn rate
top impacted endpoints
deploy markers
incident markers
```

For ScyllaDB-backed endpoints, include:

```text
DB operation latency contribution
DB error categories
```

---

## 35. Repository Dashboard

By operation:

```text
QPS
latency p50/p95/p99
error category
timeout_unknown
retry count
rows returned
pages
fanout
LWT applied=false
stale filtered
```

This is the most useful dashboard for Java engineers.

---

## 36. Driver Dashboard

Show:

```text
open connections
in-flight requests
request latency
timeouts
retries
speculative executions
pool saturation
node availability
local DC
connection errors
```

If app p99 high but DB server okay, driver dashboard may reveal client saturation.

---

## 37. Cluster Dashboard

Show:

```text
node status
CPU/reactor utilization
read/write latency
timeouts
disk usage
compaction backlog
cache hit
network
repair
streaming
```

Use official ScyllaDB monitoring stack if available, then customize for your operations.

---

## 38. Table Dashboard

For each critical table:

```text
read/write QPS
latency
disk usage
SSTables
compaction
tombstones
large partition
cache hit
```

Group by:

```text
source tables
derived tables
TTL-heavy tables
LWT tables
```

---

## 39. Tenant Dashboard

Show:

```text
top tenants by QPS
top tenants by latency
top tenants by timeout
top tenants by storage
quota rejects
active exports/backfills
mega tenant p99
noisy neighbor candidates
```

Use top-N, not all tenant labels.

---

## 40. Backfill Dashboard

Show:

```text
job status
progress
rows/sec
write latency
retry rate
DLQ count
checkpoint lag
tenant progress
cluster impact
pause state
```

A backfill without dashboard is unsafe.

---

## 41. Alert Philosophy

Alert on symptoms and actionable causes.

Bad alerts:

```text
CPU > 70% for 5m
```

may be noisy.

Better:

```text
case transition error budget burn high
write timeout rate high on source table
disk usage projected full in 24h
last backup older than RPO
repair failed for TTL-heavy table
```

Alerts should have runbooks.

---

## 42. SLO Burn Rate Alerts

Burn rate alert detects consuming error budget too fast.

Example:

```text
case_detail_read SLO 99.9%
alert if 1h burn rate high and 5m burn rate high
```

This catches real user impact while reducing noise.

---

## 43. Database Alert Examples

Useful alerts:

```text
read/write timeout rate above threshold
unavailable errors
disk usage critical
disk projected full
compaction backlog high
node down
node flapping
repair failed/overdue
backup failed/stale
large partition warnings spike
tombstone warnings spike
schema agreement/migration failure
```

Each should link to runbook.

---

## 44. Application Alert Examples

```text
timeout_unknown spike
LWT conflict abnormal spike
repository p99 above SLO
retry exhaustion
fanout partial failure
stale filtered ratio high
backfill DLQ spike
tenant quota reject spike
cursor decode errors
payload size anomaly
```

---

## 45. Alert Routing

Route alerts to owner:

- application operation alert -> service team,
- cluster/node/disk alert -> DB/SRE,
- tenant abuse/quota -> platform/customer ops,
- backup/DR -> infra/SRE,
- schema migration -> owning team.

But shared incidents need joint channel.

---

## 46. Correlation IDs

Every request should carry:

```text
request_id
trace_id
tenant_id/context
command_id for writes
```

Command writes should also have:

```text
idempotency_key
event_id
source_version
```

These enable investigation across logs, traces, and tables.

---

## 47. High-Cardinality Discipline

Do not use these as metric labels:

```text
case_id
user_id
email
raw partition key
request_id
trace_id
```

Use them in logs/traces with sampling/redaction.

Metric labels should be bounded:

```text
operation
table
profile
result
tenant_tier
region
dc
```

For tenant_id, use top-N or separate pipeline.

---

## 48. PII and Security

Observability can leak data.

Protect:

- logs,
- traces,
- metrics labels,
- dashboard access,
- backup URIs,
- query values.

Redact/hash sensitive keys.

Audit dashboard access for regulated systems.

---

## 49. Deploy Markers

Dashboards should show:

- application deploy,
- driver config change,
- schema migration,
- backfill start/stop,
- ScyllaDB upgrade,
- repair,
- node replacement,
- traffic shift,
- tenant migration.

Many incidents correlate with changes.

---

## 50. p99 Diagnosis Workflow

When p99 rises:

```text
1. Is user SLO affected?
2. Which endpoint?
3. Which repository operation?
4. Which table?
5. Is error rate also up?
6. Is rows/pages/fanout up?
7. Is retry/speculative up?
8. Which tenants?
9. Any hot key?
10. DB table metrics?
11. Node/shard issue?
12. Compaction/repair/streaming?
13. Recent deploy/backfill/schema change?
14. Mitigate: throttle/pause/disable/degrade.
15. Permanent fix.
```

---

## 51. Example: p99 Read Spike

Symptoms:

```text
GET /assignee-queue p99 4x
```

Repository metrics:

```text
open_cases.find_by_assignee_day_bucket p99 high
fanout_count=8 normal
rows_fetched=400
stale_filtered=350 high
```

DB metrics:

```text
tombstone warnings on open_cases table
compaction backlog high
```

Cause:

```text
derived table stale/tombstone-heavy
```

Mitigation:

- reduce polling,
- pause backfill,
- run reconciliation,
- tune cleanup/rebuild.

Permanent:

- fix projection delete/update pattern,
- source_version validation,
- better bucket/TTL design.

---

## 52. Example: Write Timeout Spike

Symptoms:

```text
case_transition timeout_unknown high
```

Metrics:

```text
LWT latency high
applied=false high
same partition_key_hash sampled
```

Cause:

```text
hot case with concurrent updates
```

Mitigation:

- per-case command serialization,
- UI disable duplicate submit,
- backoff,
- queue.

Permanent:

- workflow design,
- event command model,
- reduce contention.

---

## 53. Example: Cluster-Wide p99 Spike

Symptoms:

```text
many endpoints p99 high
```

DB metrics:

```text
compaction pending high
disk IO high
backfill job active
```

Cause:

```text
backfill too aggressive
```

Mitigation:

- pause backfill,
- reduce throttle,
- resume canary.

Permanent:

- adaptive throttle,
- maintenance window,
- capacity plan.

---

## 54. Example: Tenant Noisy Neighbor

Symptoms:

```text
all tenants p99 degraded
```

Tenant dashboard:

```text
tenant_X write QPS 20x normal
tenant_X export active
retry rate high
```

Mitigation:

- throttle tenant_X,
- pause export,
- communicate.

Permanent:

- quotas,
- tenant tier capacity,
- export scheduling.

---

## 55. Example: Driver Saturation

Symptoms:

```text
app p99 high
DB server normal
```

Driver metrics:

```text
in-flight requests high
pool saturated
timeouts before DB latency spike
```

Cause:

```text
unbounded async in service
```

Mitigation:

- reduce concurrency,
- enable backpressure,
- shed load.

Permanent:

- bounded executor/semaphore,
- load test.

---

## 56. Observability-Driven Design Review

Before approving new table/query, require:

```text
operation metric name
table metric mapping
expected QPS
expected rows
expected fanout
expected payload bytes
timeout profile
error taxonomy
tenant labels/log fields
slow query log fields
dashboard updates
alerts if critical
```

Observability is part of design, not afterthought.

---

## 57. Monitoring Derived Freshness

Derived views need freshness metrics:

```text
projection_lag_seconds
source_version_lag
stale_candidate_ratio
reconciliation_lag
DLQ count
projector checkpoint lag
```

User-visible stale data often appears as “wrong data”, not latency.

---

## 58. Monitoring Data Correctness

Some issues are correctness, not availability.

Metrics/checks:

```text
source vs derived count mismatch
shadow read mismatch
idempotency duplicate conflict
unexpected enum value
negative counter
missing current for event
orphan derived row
privacy deletion replay lag
```

Use scheduled validators.

---

## 59. Synthetic Checks

Run synthetic probes:

```text
write/read test tenant
LWT conflict test
derived projection test
backup freshness check
search index check
multi-region read check
```

Synthetic checks catch issues before users do.

Do not overload production with heavy synthetic queries.

---

## 60. Runbook Links

Every alert should link:

```text
what it means
how to confirm
immediate mitigation
owner
dashboards
logs query
long-term fix
```

No runbook = alert is incomplete.

---

## 61. Common Anti-Patterns

### 61.1 Only Cluster Metrics

Cannot map to user operation.

### 61.2 Only Application Metrics

Cannot see compaction/disk/repair.

### 61.3 Averages Only

Tail hidden.

### 61.4 High-Cardinality Labels

Metrics system melts.

### 61.5 Logging Raw PII Keys

Security/compliance issue.

### 61.6 No Tenant Visibility

Noisy neighbor invisible.

### 61.7 No Retry Metrics

Retry storm hidden.

### 61.8 No Backfill Dashboard

Migration incident likely.

### 61.9 Alerts Without Runbooks

On-call confusion.

### 61.10 Observability Added After Incident

Too late.

---

## 62. Observability Checklist

```text
[ ] SLOs defined for critical endpoints.
[ ] Repository operation metrics emitted.
[ ] Driver metrics exported.
[ ] ScyllaDB cluster metrics monitored.
[ ] Table-level dashboards exist.
[ ] Tenant/noisy-neighbor visibility exists.
[ ] Latency histograms include p99/p999.
[ ] Error taxonomy metrics exist.
[ ] Retry/speculative metrics exist.
[ ] Fanout/paging metrics exist.
[ ] Slow query structured logs exist.
[ ] Tracing configured with safe attributes.
[ ] Backfill/export dashboards exist.
[ ] Repair/backup alerts exist.
[ ] Alerts route to owners and link runbooks.
[ ] PII redaction reviewed.
[ ] Deploy/operation markers on dashboards.
```

---

## 63. Mental Model Compression

Remember:

```text
Application metrics tell what users feel.
Driver metrics tell what clients are doing.
Database metrics tell what resources are doing.
Logs/traces connect a single request.
Dashboards connect patterns.
Alerts demand action.
```

And:

```text
p99 debugging is correlation across operation, table, tenant, node, shard, and recent changes.
```

---

## 64. Summary

Observability is how you operate ScyllaDB systems without guessing.

Key lessons:

1. Observability must span application, driver, and database layers.
2. SLOs should represent user-facing quality.
3. Repository operation metrics are essential.
4. Error taxonomy must distinguish timeout, unknown, unavailable, overload, conflict, and bugs.
5. Retries/speculative execution need metrics because they add load.
6. Fanout, paging, rows fetched, rows returned, and stale filtering must be visible.
7. Tenant-level visibility is required for multi-tenant systems.
8. Shard/table metrics reveal problems cluster averages hide.
9. Structured slow query logs are critical.
10. Tracing should be sampled and PII-safe.
11. Dashboards must answer operational questions.
12. Alerts should be actionable and linked to runbooks.
13. High-cardinality labels can break monitoring.
14. Derived view freshness/correctness need explicit metrics.
15. Synthetic checks and validators catch correctness issues.
16. Observability must be designed with every new table/query.

---

## 65. Review Questions

1. Apa tiga layer observability ScyllaDB-backed service?
2. Apa beda SLI dan SLO?
3. Apa RED metrics?
4. Apa USE metrics?
5. Kenapa repository operation metrics penting?
6. Mengapa latency average tidak cukup?
7. Apa error taxonomy yang wajib?
8. Kenapa timeout_unknown perlu metric khusus?
9. Apa metrik penting untuk LWT?
10. Apa metrik fanout yang penting?
11. Kenapa tenant-level observability sulit?
12. Apa risiko high-cardinality labels?
13. Apa informasi slow query log yang penting?
14. Kapan tracing harus disampling?
15. Apa dashboard minimal?
16. Apa alert database yang penting?
17. Bagaimana workflow diagnosis p99?
18. Bagaimana mendeteksi noisy neighbor?
19. Apa metrik derived freshness?
20. Apa observability checklist?

---

## 66. Practical Exercise

Desain observability untuk endpoint:

```text
GET /tenants/{tenantId}/assignees/{assigneeId}/open-cases
```

yang membaca:

```text
open_cases_by_assignee_day_bucket
fanout bucket_count=8
validasi sebagian ke case_current_by_id
```

Tulis:

```text
1. endpoint SLO
2. repository operation names
3. metrics per repository
4. fanout metrics
5. stale filtering metrics
6. tenant labels/log fields
7. slow query log schema
8. trace span attributes
9. dashboard panels
10. alerts
11. noisy neighbor detection
12. p99 diagnosis runbook
13. PII redaction plan
```

---

## 67. Preview Part 030

Part berikutnya membahas:

```text
Failure Modelling:
partial failures,
timeouts,
unknown outcomes,
network partitions,
node failures,
slow replicas,
retry storms,
split-brain,
data corruption,
operator errors,
and designing graceful degradation.
```

Part 029 membahas observability.

Part 030 akan membangun failure model secara sistematis agar desain aplikasi tidak rapuh.

---

# End of Part 029

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Operations III: Backup, Restore, Disaster Recovery, Snapshots, PITR Considerations, Tenant Restore, Backup Validation, dan DR Runbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-030.md">Part 030 — Failure Modelling: Partial Failures, Timeouts, Unknown Outcomes, Network Partitions, Slow Replicas, Retry Storms, Split-Brain, Data Corruption, Operator Errors, dan Graceful Degradation ➡️</a>
</div>

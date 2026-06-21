# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-022.md

# Observability, Monitoring, and Alerting

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `022`  
> Fokus: observability produksi untuk QuestDB sebagai time-series database: ingestion freshness, WAL health, query latency, disk growth, table state, dan alert yang actionable.

---

## 1. Tujuan Part

Setelah bagian ini, kamu harus mampu:

1. Mendesain observability QuestDB yang mengukur **kebenaran fungsi sistem**, bukan hanya proses hidup/mati.
2. Membedakan monitoring untuk:
   - node health,
   - ingestion health,
   - WAL/apply health,
   - query health,
   - storage lifecycle,
   - table-level data freshness,
   - application-level SLO.
3. Menulis query monitoring yang aman terhadap QuestDB sendiri.
4. Mendesain alert yang actionable, tidak noisy, dan tidak terlalu terlambat.
5. Membuat dashboard yang berguna untuk operator, developer, dan stakeholder produk.
6. Mengintegrasikan QuestDB dengan Prometheus/Grafana tanpa menjadikan QuestDB monitoring sebagai beban tambahan yang berbahaya.

Part ini sengaja tidak mengulang observability umum yang mungkin sudah kamu kenal dari Kubernetes, Prometheus, Grafana, atau application metrics. Fokusnya adalah **apa yang spesifik untuk time-series database dan QuestDB**.

---

## 2. Problem yang Sedang Diselesaikan

Banyak sistem database dianggap “sehat” karena:

```text
process is running
port is open
health endpoint returns 200
CPU is not 100%
disk is not yet full
```

Untuk QuestDB, itu belum cukup.

Sistem bisa terlihat hidup tetapi secara fungsional gagal:

```text
ILP accepts writes
but WAL apply is lagging

queries return results
but latest data is 18 minutes stale

node is alive
but one critical table is suspended

CPU is normal
but disk is filling faster than retention removes data

p95 query is fine
but p99 dashboard query causes memory pressure every 5 minutes

Prometheus scrapes metrics
but nobody monitors event-time freshness per table
```

Observability QuestDB harus menjawab pertanyaan produksi berikut:

```text
Can producers write?
Are accepted writes being applied?
Are tables query-fresh enough?
Are critical materialized views current?
Are queries bounded and stable?
Is disk growth under control?
Are partitions aging out as expected?
Are late/backfill lanes damaging live ingestion?
Are schema/cardinality changes causing physical pressure?
Can we recover before SLO is violated?
```

---

## 3. Mental Model Utama

Observability QuestDB adalah observability terhadap **pipeline data temporal**:

```text
producer
  -> network endpoint
  -> ingestion protocol
  -> WAL / commit boundary
  -> WAL apply
  -> table storage
  -> materialized views / rollups
  -> query/API/dashboard
  -> business decision
```

Setiap stage punya failure mode berbeda.

### 3.1 Jangan Monitor Hanya Node; Monitor Flow

Node metrics menjawab:

```text
Is the machine healthy?
```

Flow metrics menjawab:

```text
Is time-series data moving correctly through the system?
```

QuestDB production monitoring harus lebih dekat ke flow metrics.

### 3.2 SLO Utama Bukan Hanya Latency, Tetapi Freshness

Dalam TSDB, query yang cepat tetapi stale sering lebih berbahaya daripada query yang sedikit lambat.

Contoh:

```text
Dashboard p95 latency = 200 ms
latest sensor data shown = 47 minutes old
```

Secara UI terlihat baik. Secara operasional gagal.

Freshness adalah first-class SLO:

```text
freshness_lag = now() - max(event_timestamp_seen_by_query)
```

Namun hati-hati: `now() - max(ts)` hanya benar jika event timestamp memang merepresentasikan kejadian aktual dan producer clock valid.

Untuk sistem matang, kamu biasanya perlu dua metrik:

```text
event_time_freshness = now() - max(event_ts)
ingestion_time_freshness = now() - max(ingested_at)
```

Keduanya menjawab hal berbeda:

| Metric | Menjawab |
|---|---|
| `event_time_freshness` | apakah data domain terbaru sudah terlihat? |
| `ingestion_time_freshness` | apakah database masih menerima data baru? |

---

## 4. Observability Layers

QuestDB harus dimonitor di beberapa layer.

```text
Layer 0: infrastructure
Layer 1: QuestDB process/runtime
Layer 2: ingestion endpoint
Layer 3: WAL/apply pipeline
Layer 4: table freshness and volume
Layer 5: query behavior
Layer 6: materialized view / derived data
Layer 7: application-facing SLO
Layer 8: business/data-quality signal
```

### 4.1 Layer 0: Infrastructure

Monitor:

```text
CPU utilization
load average
memory usage
page cache behavior
disk used bytes
disk free bytes
disk write latency
IOPS
network ingress/egress
container restarts
filesystem read-only state
```

Untuk QuestDB, disk dan memory tidak boleh dipahami secara generik.

QuestDB sangat bergantung pada:

```text
filesystem
mmap/native memory
page cache
sequential and partition-local IO
```

Jadi alert “RAM high” bisa misleading jika sebagian besar adalah page cache yang sehat. Sebaliknya, memory yang terlihat masih tersedia belum tentu aman jika native memory/headroom query habis.

### 4.2 Layer 1: QuestDB Process/Runtime

Monitor:

```text
process up
health endpoint
server logs
startup/restart count
JVM/native memory symptoms
worker pool saturation symptoms
error log rate
```

Process alive adalah necessary condition, bukan sufficient condition.

### 4.3 Layer 2: Ingestion Endpoint

Monitor:

```text
ILP HTTP request success/error rate
ILP TCP connection errors
bytes ingested
rows accepted
producer flush latency
producer retry count
producer dropped events
invalid line count
schema validation reject count
cardinality reject count
```

Sebagian besar ingestion observability harus ada di **producer/ingestion gateway**, bukan hanya QuestDB.

Kenapa?

Karena QuestDB hanya melihat data yang sampai kepadanya. Jika producer queue penuh dan membuang data sebelum write, database bisa terlihat sehat.

### 4.4 Layer 3: WAL / Apply Pipeline

Monitor:

```text
WAL enabled status
pending rows
pending transactions
sequencer/apply lag
table suspended status
apply error logs
WAL disk growth
WAL cleanup behavior
materialized view WAL state
```

QuestDB documentation menyarankan `tables()` untuk observability karena menyediakan informasi seperti pending rows, memory pressure, dedup stats, dan throughput histograms secara in-memory; `wal_tables()` tetap berguna untuk WAL status, tetapi membaca dari disk dan kurang cocok untuk polling sangat sering.

### 4.5 Layer 4: Table Freshness and Volume

Monitor per table:

```text
max designated timestamp
max ingestion timestamp if available
row growth rate
partition count
latest partition age
oldest retained partition
symbol cardinality growth
null ratio / sparse column behavior
row width drift
```

Table freshness sering lebih penting daripada global QuestDB metrics.

Contoh:

```text
market_ticks fresh: 2s
machine_telemetry fresh: 7s
compliance_events fresh: 3h
```

Global metrics bisa terlihat sehat, tetapi satu critical table stale.

### 4.6 Layer 5: Query Behavior

Monitor:

```text
query latency p50/p95/p99
slow query count
query error count
query timeout count
rows scanned approximation
result size
concurrent query count
memory pressure during query
expensive dashboard query frequency
```

Query monitoring harus dipisahkan berdasarkan workload:

```text
operator dashboard
customer API
ad hoc analyst
backfill verification
materialized view refresh
```

Jangan campur semuanya dalam satu p95 global.

### 4.7 Layer 6: Materialized View / Derived Data

Monitor:

```text
view freshness
base table freshness
view refresh lag
suspended view WAL state
partial bucket exposure
refresh failures
manual refresh backlog
```

Materialized view bisa membuat query cepat, tetapi memperkenalkan freshness boundary baru.

```text
raw table fresh != materialized view fresh
```

### 4.8 Layer 7: Application-Facing SLO

Monitor dari perspektif user/API:

```text
API latency
API error rate
API freshness reported
API query range distribution
API cardinality/filter distribution
empty-result anomaly
fallback path usage
```

API harus bisa menyampaikan data freshness.

Contoh response metadata:

```json
{
  "from": "2026-06-21T10:00:00Z",
  "to": "2026-06-21T11:00:00Z",
  "seriesCount": 124,
  "latestEventTime": "2026-06-21T10:59:58Z",
  "freshnessLagSeconds": 2,
  "source": "raw",
  "partial": false
}
```

### 4.9 Layer 8: Business/Data-Quality Signal

Monitor:

```text
expected device reporting rate
missing sensor ratio
zero-value anomaly
counter reset anomaly
price tick gap
duplicate ratio
late event ratio
correction ratio
unit mismatch reject count
```

Database metrics cannot detect semantic failure alone.

Example:

```text
QuestDB ingestion normal
rows/sec normal
query latency normal
but all temperature values are accidentally sent in Fahrenheit instead of Celsius
```

Only domain-level validation catches this.

---

## 5. QuestDB-Specific Monitoring Surfaces

QuestDB offers multiple observability surfaces:

```text
HTTP health endpoint
Prometheus metrics endpoint
Web Console Metrics View
tables() function
wal_tables() function
server logs
system/runtime metrics
query-level behavior
external probe queries
application-side metrics
```

### 5.1 Health Endpoint

Use health endpoint for basic liveness/readiness style checks.

It answers:

```text
Can I reach this QuestDB process?
```

It does not fully answer:

```text
Are all critical tables fresh?
Is WAL apply caught up?
Is disk lifecycle safe?
Are queries healthy?
```

### 5.2 Prometheus Metrics

Prometheus is appropriate for continuous scraping of QuestDB operational metrics.

Typical pattern:

```text
QuestDB metrics endpoint
  -> Prometheus scrape
  -> Alertmanager
  -> Grafana dashboards
```

Prometheus is good for:

```text
resource trend
latency trend
error rate
WAL/application pressure trend
alert thresholds
historical incident analysis
```

But Prometheus alone may not capture table-specific semantic freshness unless you export those metrics explicitly.

### 5.3 Web Console Metrics View

Useful for interactive diagnosis:

```text
WAL operations
performance charts
table-level metrics
real-time inspection
```

Good for human debugging, less suitable as the only production alerting mechanism.

### 5.4 `tables()`

Use `tables()` for lightweight table observability.

Useful for questions like:

```sql
SELECT * FROM tables();
```

Possible use cases:

```text
which tables are WAL-enabled?
which tables have pending rows?
which tables show memory pressure?
which tables have throughput anomalies?
which tables are suspended?
```

A production monitor might query a subset:

```sql
SELECT
  table_name,
  walEnabled,
  suspended,
  writerTxn,
  sequencerTxn,
  memoryPressure
FROM tables()
WHERE table_name IN ('market_ticks', 'machine_telemetry', 'api_metrics');
```

Column names can evolve across QuestDB versions, so monitoring SQL should be validated against the exact deployed version.

### 5.5 `wal_tables()`

Use `wal_tables()` when you need WAL status detail.

Example operational question:

```text
Is this table suspended?
What transaction is blocked?
```

Example:

```sql
SELECT * FROM wal_tables();
```

If a WAL table is suspended, QuestDB exposes `ALTER TABLE ... RESUME WAL` to resume after resolving the cause. Skipping a failed transaction is a serious data-integrity decision and should be gated by incident procedure.

### 5.6 Logs

Logs are critical for:

```text
WAL apply error
schema conflict
invalid ingestion
filesystem error
disk full
query memory error
startup/recovery sequence
```

But logs are not metrics.

Use logs for root cause and correlation, not as your only alerting layer.

---

## 6. Core SLOs for QuestDB

A mature QuestDB deployment should define SLOs explicitly.

### 6.1 Ingestion Availability SLO

Question:

```text
Can producers write successfully?
```

Possible indicators:

```text
ILP success rate
producer flush success
producer retry rate
producer queue depth
DLQ rate
invalid line rate
```

Example SLO:

```text
99.9% of ingestion batches accepted within 2 seconds over 10-minute windows.
```

### 6.2 Ingestion Freshness SLO

Question:

```text
How delayed is data from producer to queryable table?
```

Possible metric:

```text
now - max(ingested_at)
```

Example SLO:

```text
critical telemetry table ingestion freshness lag < 30 seconds for 99% of 5-minute windows.
```

### 6.3 Event-Time Freshness SLO

Question:

```text
How recent is the latest domain event visible to queries?
```

Possible metric:

```text
now - max(event_ts)
```

Example SLO:

```text
market_ticks event-time freshness lag < 3 seconds during trading hours.
```

Caveat: if producer clocks are wrong, event-time freshness can lie.

### 6.4 WAL Apply SLO

Question:

```text
Are committed writes being applied fast enough?
```

Possible indicators:

```text
pending rows
pending transactions
sequencerTxn - writerTxn gap
suspended table status
```

Example SLO:

```text
No critical WAL table remains suspended for more than 1 minute.
```

### 6.5 Query Latency SLO

Question:

```text
Can users query within expected latency?
```

Define by query class:

| Query Class | Example SLO |
|---|---|
| latest state API | p95 < 100 ms |
| 1-hour dashboard | p95 < 500 ms |
| 24-hour dashboard | p95 < 2 s |
| ad hoc analyst | best effort / isolated |
| backfill validation | batch window only |

Do not define one global query latency SLO.

### 6.6 Storage Safety SLO

Question:

```text
Will disk exhaustion happen before humans can respond?
```

Monitor:

```text
disk used percent
disk free bytes
daily growth rate
time-to-full estimate
TTL effectiveness
WAL growth rate
backup/snapshot space
```

Example alert:

```text
time_to_full < 48h for primary QuestDB volume
```

Better than:

```text
disk > 90%
```

because growth rate matters.

---

## 7. Freshness Monitoring Patterns

### 7.1 Basic Latest Timestamp Probe

For a critical table:

```sql
SELECT max(ts) AS latest_event_ts
FROM machine_telemetry;
```

Then compute externally:

```text
freshness_lag_seconds = now - latest_event_ts
```

But this query can become expensive on large tables if not optimized by metadata or partition locality. Prefer bounded query when possible:

```sql
SELECT max(ts) AS latest_event_ts
FROM machine_telemetry
WHERE ts >= dateadd('h', -1, now());
```

If data might be absent for more than one hour during normal operation, choose a window aligned with expected reporting frequency.

### 7.2 Per-Series Freshness

Global freshness can hide one stale entity.

```sql
SELECT
  device_id,
  max(ts) AS latest_event_ts
FROM machine_telemetry
WHERE ts >= dateadd('h', -1, now())
GROUP BY device_id;
```

But this can be expensive for many devices. For production, build freshness rollups or producer-side heartbeats.

### 7.3 Critical Series Watchlist

For high-cardinality device fleets, monitor only critical watchlist devices frequently:

```sql
SELECT
  device_id,
  max(ts) AS latest_event_ts
FROM machine_telemetry
WHERE
  device_id IN ('pump-001', 'pump-042', 'line-a-controller')
  AND ts >= dateadd('h', -2, now())
GROUP BY device_id;
```

Then perform broader fleet-quality checks less frequently.

### 7.4 Ingestion-Time Freshness Column

Add `ingested_at` when the domain requires distinguishing source delay from database delay.

```sql
CREATE TABLE machine_telemetry (
  ts TIMESTAMP,
  ingested_at TIMESTAMP,
  tenant SYMBOL,
  device_id SYMBOL,
  metric SYMBOL,
  value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Then monitor:

```sql
SELECT
  max(ts) AS latest_event_time,
  max(ingested_at) AS latest_ingest_time
FROM machine_telemetry
WHERE ingested_at >= dateadd('m', -30, now());
```

Interpretation:

| Symptom | Likely Meaning |
|---|---|
| event time stale, ingestion time stale | producer/source stopped or DB not receiving |
| event time stale, ingestion time fresh | source is sending old data / replay / clock issue |
| event time fresh, ingestion time fresh | normal |
| event time future | clock skew or timestamp bug |

### 7.5 Heartbeat Table Pattern

For large fleets, create a separate heartbeat/status table.

```sql
CREATE TABLE device_heartbeat (
  ts TIMESTAMP,
  ingested_at TIMESTAMP,
  tenant SYMBOL,
  device_id SYMBOL,
  status SYMBOL,
  firmware_version SYMBOL,
  source_region SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

This avoids scanning every measurement table just to know if devices are alive.

---

## 8. WAL Monitoring Patterns

### 8.1 Critical Table WAL State

Pseudo-query:

```sql
SELECT
  table_name,
  walEnabled,
  suspended,
  writerTxn,
  sequencerTxn
FROM tables()
WHERE table_name IN ('market_ticks', 'machine_telemetry', 'api_metrics');
```

Interpretation:

| Condition | Meaning |
|---|---|
| `walEnabled=false` unexpectedly | table may not support expected concurrent/recovery behavior |
| `suspended=true` | WAL apply is blocked; urgent for critical table |
| transaction gap growing | apply lag or writer issue |
| pending rows growing | ingestion faster than apply or apply blocked |

### 8.2 Suspended Table Runbook

When a table is suspended:

```text
1. Stop or isolate suspicious producers if corruption/schema conflict is ongoing.
2. Inspect QuestDB logs around first suspension time.
3. Identify failed transaction and table.
4. Determine cause:
   - schema change conflict
   - invalid WAL transaction
   - disk error
   - O3/backfill overload
   - bug/version issue
5. Decide recovery:
   - fix environment and resume
   - skip transaction only if accepted by data owner
   - restore/replay if data integrity requires it
6. Resume WAL.
7. Verify freshness and row counts.
8. Add prevention test/guardrail.
```

Example command after resolving cause:

```sql
ALTER TABLE machine_telemetry RESUME WAL;
```

Skipping a transaction should be treated like a data loss/correction event, not a routine operational command.

---

## 9. Query Monitoring Patterns

### 9.1 Query Classes

Classify queries first.

```text
Q1: latest-state API
Q2: short-range dashboard
Q3: rollup dashboard
Q4: ad hoc analyst query
Q5: backfill validation query
Q6: materialized view refresh query
Q7: monitoring probe query
```

Each class has different acceptable latency and resource budget.

### 9.2 Query Guardrail Metrics in Java

Your Java query service should emit:

```text
query_template_name
requested_range_seconds
series_filter_count
tenant_count
result_rows
latency_ms
questdb_error_class
timeout
source_table_or_view
freshness_lag_seconds
```

Example Micrometer metric dimensions:

```text
questdb_query_latency{template="device_1h", source="raw"}
questdb_query_latency{template="fleet_daily", source="mv_1m"}
questdb_query_errors{template="device_1h", error="timeout"}
questdb_query_range_seconds{template="custom_range"}
```

Avoid high-cardinality labels like raw device IDs in metrics labels.

### 9.3 Slow Query Log Strategy

For every slow query event, capture:

```text
query template ID
sanitized SQL shape
range duration
requested tenant
series count
result row count
latency
whether cache/page-cache warm
error or timeout
```

Do not log raw arbitrary SQL with sensitive values unless policy allows it.

### 9.4 Query Storm Detection

Symptoms:

```text
query latency rises
CPU rises
memory pressure rises
WAL apply lag rises
producer retries rise
```

A query storm can damage ingestion indirectly by competing for CPU/memory/disk.

Mitigation:

```text
separate query roles/users
route heavy queries to replica if available
limit time range in API
use materialized views for dashboard
reject unbounded custom queries
timeout analyst queries
schedule backfill validation off-peak
```

---

## 10. Storage and Retention Monitoring

### 10.1 Disk Metrics

Monitor:

```text
used bytes
free bytes
growth bytes/hour
time to full
WAL directory growth
partition directory growth
backup/snapshot growth
object storage lifecycle failure
```

Static threshold is insufficient.

Better:

```text
alert when projected time_to_full < 48h
alert when WAL grows faster than table data for sustained period
alert when TTL is configured but oldest partition age keeps increasing
```

### 10.2 Retention Effectiveness

For each retention-managed table:

```text
expected retention window
actual oldest partition
actual oldest timestamp
actual disk footprint
```

Potential failure:

```text
TTL configured in theory
but partition granularity prevents old data from being dropped promptly
```

Example:

```text
TTL = 7 days
PARTITION BY MONTH
```

This can retain much more than 7 days because TTL drops whole partitions.

### 10.3 Capacity Regression Detection

Watch for sudden changes in:

```text
bytes per row
rows per second
symbol cardinality
string column growth
null-heavy sparse columns
index footprint
materialized view footprint
```

A schema change can double storage cost without increasing row count.

---

## 11. Alert Design

### 11.1 Alert Philosophy

Good alerts are:

```text
actionable
symptom-oriented
SLO-linked
rate/window-based
owned by a team
connected to runbook
```

Bad alerts are:

```text
raw metric threshold without context
noisy during normal backfill
missing table-level dimension
triggered after user-visible failure
owned by nobody
```

### 11.2 Recommended Alert Families

#### A. Availability

```text
QuestDB process down
health endpoint unavailable
PGWire unavailable
ILP endpoint unavailable
```

#### B. Ingestion

```text
ingestion success rate below threshold
producer retry rate high
producer queue near capacity
DLQ rate above zero for critical pipeline
invalid line/schema rejection spike
```

#### C. Freshness

```text
critical table event-time freshness lag > threshold
critical table ingestion-time freshness lag > threshold
materialized view freshness lag > threshold
critical series heartbeat missing
```

#### D. WAL

```text
critical WAL table suspended
WAL transaction gap growing
pending rows growing for sustained period
WAL disk growth abnormal
```

#### E. Query

```text
API query p95/p99 above SLO
query timeout rate high
slow dashboard query spike
result-size guardrail exceeded
ad hoc query pool saturated
```

#### F. Storage

```text
time to full < threshold
free disk < emergency threshold
TTL not reducing old partitions
backup/snapshot failure
Parquet/offload conversion failure
```

#### G. Data Quality

```text
expected device reporting ratio below threshold
duplicate ratio spike
late event ratio spike
future timestamp detected
unit validation reject spike
counter reset anomaly spike
```

### 11.3 Alert Severity Model

Example:

| Severity | Meaning | Example |
|---|---|---|
| SEV1 | user/business-critical data unavailable or stale | critical market table stale > 60s during trading |
| SEV2 | degradation likely to become user-visible | WAL lag growing for 10 min |
| SEV3 | needs investigation but not urgent | cardinality growth anomaly |
| SEV4 | hygiene / follow-up | dashboard query near limit |

### 11.4 Avoiding Alert Noise During Backfill

Backfill changes normal behavior:

```text
higher rows/sec
older event timestamps
O3 writes
WAL growth
disk growth
query latency impact
```

Introduce maintenance/backfill mode metrics:

```text
pipeline_mode = live | backfill | replay | maintenance
```

Alert rules can then distinguish:

```text
late event spike during live mode => suspicious
late event spike during backfill mode => expected within budget
```

---

## 12. Dashboard Design

Do not build one giant dashboard. Build dashboards by audience and decision.

### 12.1 Operator Dashboard

Purpose:

```text
Is QuestDB healthy right now?
```

Panels:

```text
node up / health
CPU / memory / disk / IO
ILP request/error rate
WAL pending rows / suspended tables
table freshness for critical tables
query p95/p99 by class
disk time-to-full
recent errors
```

### 12.2 Ingestion Pipeline Dashboard

Purpose:

```text
Are producers delivering data safely?
```

Panels:

```text
producer events generated/sec
producer events sent/sec
accepted/sec
retries/sec
queue depth
DLQ count
invalid schema reject count
late event ratio
duplicate ratio
freshness lag
```

### 12.3 Query/API Dashboard

Purpose:

```text
Are users getting fast and fresh answers?
```

Panels:

```text
API request rate
latency by endpoint/query template
error/timeout rate
query range distribution
result rows distribution
source raw vs materialized view
freshness returned to clients
```

### 12.4 Data Quality Dashboard

Purpose:

```text
Is the data semantically trustworthy?
```

Panels:

```text
missing series
expected vs actual device report count
future timestamp count
zero/null anomaly
unit reject count
outlier rate
counter reset count
correction count
```

### 12.5 Capacity Dashboard

Purpose:

```text
When will storage or cardinality become a problem?
```

Panels:

```text
rows/day by table
bytes/day by table
disk time-to-full
partition count
oldest retained timestamp
WAL size trend
symbol cardinality trend
MV storage trend
backup size trend
```

---

## 13. Java Engineer Perspective

QuestDB observability is not only database-side. Your Java services must cooperate.

### 13.1 Ingestion Gateway Metrics

Emit:

```text
events_received_total
events_validated_total
events_rejected_total
events_sent_to_questdb_total
events_dlq_total
flush_latency_ms
batch_size
queue_depth
retry_count
circuit_breaker_state
late_event_count
duplicate_candidate_count
schema_version_count
```

Avoid raw tenant/device as Prometheus labels.

Use controlled dimensions:

```text
pipeline
source_type
table
reason
mode
```

### 13.2 Query Service Metrics

Emit:

```text
questdb_query_latency_ms
questdb_query_timeout_total
questdb_query_error_total
questdb_result_rows
questdb_requested_range_seconds
questdb_freshness_lag_seconds
questdb_source_table
questdb_query_template
```

### 13.3 Returning Freshness to API Consumers

A production API should not hide stale data.

Return metadata:

```json
{
  "data": [],
  "meta": {
    "source": "device_telemetry_1m_mv",
    "latestEventTime": "2026-06-21T09:59:00Z",
    "freshnessLagSeconds": 60,
    "partial": false,
    "queryRangeSeconds": 3600
  }
}
```

This helps callers distinguish:

```text
empty because no data exists
empty because source is stale
empty because filter too narrow
empty because query failed partially
```

### 13.4 Circuit Breaker Behavior

Your ingestion client should not retry blindly forever.

Recommended states:

```text
CLOSED: normal
OPEN: QuestDB unavailable or repeated flush failure
HALF_OPEN: probe with small batch
DEGRADED: accepting data but queue near capacity
DRAINING: service shutting down / flushing
```

Metrics should expose state transitions.

### 13.5 DLQ Observability

DLQ is not success.

Monitor:

```text
DLQ write rate
DLQ age
DLQ replay success
DLQ reason distribution
oldest unreplayed event
```

A growing DLQ means the ingestion system is preserving failure, not resolving it.

---

## 14. Probe Queries: Useful but Dangerous

Monitoring probes are queries too. They can harm the database if careless.

### 14.1 Safe Probe Principles

```text
bound every probe by time
probe critical tables only at high frequency
avoid high-cardinality GROUP BY frequently
avoid scanning raw multi-month tables
use materialized/summary tables for fleet-wide probes
separate fast probes from expensive audits
```

### 14.2 Example: Critical Table Freshness Probe

```sql
SELECT max(ts) AS latest_ts
FROM market_ticks
WHERE ts >= dateadd('m', -10, now());
```

### 14.3 Example: WAL State Probe

```sql
SELECT
  table_name,
  suspended
FROM tables()
WHERE table_name IN ('market_ticks', 'orders_telemetry', 'api_metrics');
```

### 14.4 Example: Fleet Reporting Probe from Heartbeat Table

```sql
SELECT count_distinct(device_id) AS active_devices
FROM device_heartbeat
WHERE ts >= dateadd('m', -5, now());
```

### 14.5 Expensive Probe Anti-Pattern

```sql
SELECT device_id, max(ts)
FROM machine_telemetry
GROUP BY device_id;
```

If run every 15 seconds on a huge table, your monitoring becomes a production workload.

Better:

```text
write heartbeat table
maintain rollup
sample subset frequently
run full fleet audit every N minutes
```

---

## 15. Failure Mode Catalog

### 15.1 QuestDB Up, Data Stale

Symptoms:

```text
health endpoint OK
queries succeed
latest timestamp old
producer retries maybe high
WAL pending rows maybe high
```

Possible causes:

```text
producer stopped
network issue
ILP endpoint issue
WAL apply lag
table suspended
source system stopped
clock skew
```

First checks:

```text
producer sent/sec
ILP success/error
critical table freshness
WAL state
ingestion timestamp freshness
logs
```

### 15.2 Writes Accepted, Queries Behind

Symptoms:

```text
producer success
WAL pending rows increasing
query freshness lag increasing
```

Possible causes:

```text
apply workers saturated
O3/backfill storm
disk latency
materialized view refresh contention
query storm competing resources
```

Mitigations:

```text
throttle backfill
increase/apply worker capacity carefully
reduce query load
move expensive queries to MV/replica
check disk latency
```

### 15.3 Table Suspended

Symptoms:

```text
suspended=true
freshness stuck
logs show WAL apply error
```

Possible causes:

```text
bad transaction
schema conflict
disk/corruption issue
bug/version issue
```

Mitigation:

```text
identify cause
stop offending producer
resume only after fix
skip transaction only with data-owner approval
verify row count/freshness
```

### 15.4 Disk Time-to-Full Collapse

Symptoms:

```text
disk growth rate jumps
WAL grows
TTL not reducing data
new columns or cardinality surge
backfill active
```

Possible causes:

```text
producer duplicated data
new high-cardinality label
retention misconfigured
backfill too aggressive
MV created unexpectedly large
Parquet/offload failure
```

Mitigation:

```text
stop bad producer/backfill
estimate rollback/drop strategy
review new schema/cardinality
drop/detach old partitions if policy allows
expand disk only as temporary measure
```

### 15.5 Query Storm

Symptoms:

```text
query latency up
CPU/memory pressure up
WAL apply lag up
API timeout up
```

Possible causes:

```text
new dashboard
unbounded custom query
analyst query on raw data
missing materialized view
large time range default
```

Mitigation:

```text
timeout/kill offending query if possible
add API guardrail
route dashboard to MV
limit ad hoc query access
review query template
```

### 15.6 Freshness Metric Lies

Symptoms:

```text
freshness appears good
but operators see old data
```

Possible causes:

```text
producer timestamp in future
wrong timestamp column
heartbeat still active but measurements stopped
ingestion timestamp used instead of event timestamp
materialized view stale but raw table fresh
```

Mitigation:

```text
monitor both event time and ingestion time
validate future timestamp
monitor per data type, not just heartbeat
include source table/view in API response
```

---

## 16. Monitoring Architecture Patterns

### 16.1 Minimal Production Stack

```text
QuestDB metrics endpoint
  -> Prometheus
  -> Alertmanager
  -> Grafana

QuestDB logs
  -> Loki/ELK/OpenSearch/etc.

Java ingestion/query services
  -> Micrometer/Prometheus

Freshness probes
  -> small external monitor
  -> Prometheus custom metrics
```

### 16.2 Freshness Exporter Pattern

Build a small service:

```text
freshness-exporter
  - runs bounded SQL probes
  - computes lag
  - exports Prometheus metrics
```

Example exported metrics:

```text
questdb_table_event_freshness_seconds{table="market_ticks"} 2
questdb_table_ingest_freshness_seconds{table="machine_telemetry"} 7
questdb_table_suspended{table="market_ticks"} 0
questdb_mv_freshness_seconds{view="telemetry_1m"} 65
```

Use low-cardinality labels.

### 16.3 Synthetic Write Probe

For high-criticality systems, run a synthetic write/read probe.

Flow:

```text
write unique synthetic event
wait small interval
query it back
measure end-to-end latency
```

This tests more than process health:

```text
network
ILP endpoint
WAL
apply
query path
```

But do not run it too frequently or pollute production tables. Use a dedicated table with TTL.

Example table:

```sql
CREATE TABLE questdb_synthetic_probe (
  ts TIMESTAMP,
  probe_id SYMBOL,
  source SYMBOL,
  value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

### 16.4 Canary Producer Pattern

A canary producer sends known low-rate events continuously.

If canary freshness fails, database/pipeline likely has a systemic issue.

If canary freshness is fine but one business table is stale, issue is likely upstream/domain-specific.

---

## 17. Data Quality Monitoring

### 17.1 Late Event Ratio

Track:

```text
late_event = ingested_at - event_ts > allowed_delay
```

Example categories:

```text
0-5s normal
5-60s delayed
1-10m late
>10m replay/backfill
future timestamp invalid
```

### 17.2 Duplicate Ratio

Track duplicate candidates before QuestDB dedup:

```text
same natural key seen again
same event id repeated
same device/metric/timestamp repeated
```

A duplicate spike often means:

```text
producer retry storm
consumer group rebalance
broker replay
upstream bug
```

### 17.3 Missing Series Ratio

Expected vs actual:

```text
expected devices reporting in last 5m = 10,000
actual devices reporting in last 5m = 9,842
missing ratio = 1.58%
```

This is business-level health, not database-level health.

### 17.4 Value Validity

Examples:

```text
temperature outside physical range
negative latency
counter decreases unexpectedly
status enum unknown
unit mismatch
future timestamp
zero-value burst
```

Reject invalid data before QuestDB when possible. Also count rejects.

---

## 18. Runbook Templates

### 18.1 Freshness Alert Runbook

Alert:

```text
critical table freshness lag > threshold
```

Steps:

```text
1. Check if freshness lag is event-time or ingestion-time.
2. Check producer sent/sec and error/retry rate.
3. Check ILP endpoint availability.
4. Check QuestDB WAL/table status.
5. Check disk free/time-to-full.
6. Check recent deployments/schema changes.
7. Check if backfill/replay is active.
8. Compare raw table vs materialized view freshness.
9. Decide mitigation:
   - restart producer
   - throttle backfill
   - resume WAL after root cause
   - route API to raw/alternate source
   - declare degraded freshness
10. Record root cause and prevention.
```

### 18.2 WAL Suspended Runbook

```text
1. Identify table/view and first suspension time.
2. Check logs around first failure.
3. Stop suspicious producer if needed.
4. Determine if data transaction is valid, invalid, or unknown.
5. Fix root cause.
6. Resume WAL normally if safe.
7. If skipping transaction, get data-owner approval.
8. Verify data freshness and consistency.
9. Replay missing data if needed.
10. Add contract test/producer guardrail.
```

### 18.3 Disk Growth Runbook

```text
1. Calculate growth rate and time-to-full.
2. Identify top-growing tables/directories.
3. Check WAL vs table data growth.
4. Check recent backfill/replay jobs.
5. Check schema/cardinality changes.
6. Check TTL/partition retention behavior.
7. Stop or throttle offending pipeline.
8. Apply safe retention/drop/detach only with approval.
9. Expand disk if immediate risk, but treat as mitigation not root fix.
10. Update capacity model.
```

### 18.4 Query Latency Runbook

```text
1. Identify affected query class.
2. Check API templates/ranges/result sizes.
3. Check concurrent query load.
4. Check if query is raw or MV-based.
5. Check CPU/memory/disk latency.
6. Check recent dashboard or analyst activity.
7. Apply temporary guardrail/disable heavy query.
8. Add MV or tighten API range if needed.
9. Review query execution shape.
10. Add regression test.
```

---

## 19. Anti-Patterns

### Anti-Pattern 1: “Health endpoint OK means database OK”

Wrong because table can be suspended or stale.

### Anti-Pattern 2: Monitoring only infrastructure metrics

CPU/disk/memory do not tell you whether time-series data is fresh.

### Anti-Pattern 3: Global freshness only

One active table can hide another stale critical table.

### Anti-Pattern 4: Expensive monitoring queries

Monitoring should not become your heaviest workload.

### Anti-Pattern 5: No ingestion-side metrics

QuestDB cannot report events that were dropped before reaching it.

### Anti-Pattern 6: Alerting on raw disk percent only

Time-to-full is usually more useful than `disk > 90%`.

### Anti-Pattern 7: Alerting without runbook

Every production alert should tell the responder what to inspect first.

### Anti-Pattern 8: Treating materialized view freshness as raw freshness

Derived data has its own lag and failure modes.

### Anti-Pattern 9: High-cardinality labels in Prometheus metrics

Do not put raw device ID, order ID, request ID, or user ID as metrics labels.

### Anti-Pattern 10: No backfill mode

Backfill changes ingestion and late-data behavior. Alerting must understand it.

---

## 20. Production Checklist

### QuestDB Core

- [ ] Health endpoint monitored.
- [ ] Prometheus metrics scraped.
- [ ] Logs centralized.
- [ ] Disk growth and time-to-full monitored.
- [ ] WAL/table suspension monitored.
- [ ] Pending rows / transaction lag monitored for critical tables.
- [ ] Query latency monitored by query class.
- [ ] Slow/error query events captured.

### Table Freshness

- [ ] Critical table event-time freshness monitored.
- [ ] Critical table ingestion-time freshness monitored where needed.
- [ ] Materialized view freshness monitored separately.
- [ ] Heartbeat/status table exists for large fleets.
- [ ] Per-series or watchlist freshness exists for critical devices/assets/symbols.

### Ingestion Services

- [ ] Producer sent/sec monitored.
- [ ] Producer retry/error monitored.
- [ ] Queue depth monitored.
- [ ] DLQ rate and age monitored.
- [ ] Schema validation rejects monitored.
- [ ] Late event ratio monitored.
- [ ] Duplicate candidate ratio monitored.
- [ ] Circuit breaker state exposed.

### Query/API Services

- [ ] Query templates named and measured.
- [ ] Requested time range measured.
- [ ] Result rows measured.
- [ ] Freshness returned to API consumers.
- [ ] Query timeout/error rate monitored.
- [ ] Unbounded/ad hoc query paths controlled.

### Alerting

- [ ] Alerts tied to SLOs.
- [ ] Alerts have owners.
- [ ] Alerts have runbooks.
- [ ] Backfill/replay mode integrated.
- [ ] Warning and critical thresholds are separated.
- [ ] No high-noise raw metric alerts without context.

### Data Quality

- [ ] Missing reporting ratio monitored.
- [ ] Future timestamp count monitored.
- [ ] Unit/type validation failures monitored.
- [ ] Value-range anomalies monitored.
- [ ] Counter reset/duplicate/late event trends monitored.

---

## 21. Hands-On Lab

### Lab Goal

Build a minimal production-style observability layer for one QuestDB table.

### Setup Table

```sql
CREATE TABLE machine_telemetry (
  ts TIMESTAMP,
  ingested_at TIMESTAMP,
  tenant SYMBOL,
  site SYMBOL,
  device_id SYMBOL,
  metric SYMBOL,
  value DOUBLE,
  quality SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

### Task 1: Insert Synthetic Data

Insert:

```text
normal current events
late events
future timestamp event
duplicate candidate
```

### Task 2: Freshness Queries

Write queries for:

```text
latest event time
latest ingestion time
freshness by tenant
freshness by critical device list
future timestamp count
late event count
```

### Task 3: WAL/Table Probe

Write monitoring query using:

```sql
SELECT * FROM tables();
```

Then restrict to the target table.

### Task 4: Java Exporter Sketch

Implement a small scheduled component that:

```text
runs bounded freshness query every 30s
computes lag
exports Micrometer gauges
logs state changes
never labels by raw device_id except controlled watchlist
```

Pseudo-code:

```java
@Component
public final class QuestDbFreshnessProbe {
    private final JdbcTemplate jdbc;
    private final AtomicLong eventLagSeconds = new AtomicLong(-1);
    private final AtomicLong ingestLagSeconds = new AtomicLong(-1);

    public QuestDbFreshnessProbe(JdbcTemplate jdbc, MeterRegistry registry) {
        this.jdbc = jdbc;
        Gauge.builder("questdb.table.event_freshness.seconds", eventLagSeconds, AtomicLong::get)
            .tag("table", "machine_telemetry")
            .register(registry);
        Gauge.builder("questdb.table.ingest_freshness.seconds", ingestLagSeconds, AtomicLong::get)
            .tag("table", "machine_telemetry")
            .register(registry);
    }

    @Scheduled(fixedDelayString = "PT30S")
    public void probe() {
        var row = jdbc.queryForMap("""
            SELECT max(ts) AS latest_event_ts, max(ingested_at) AS latest_ingest_ts
            FROM machine_telemetry
            WHERE ingested_at >= dateadd('m', -30, now())
        """);

        Instant now = Instant.now();
        Instant latestEvent = toInstant(row.get("latest_event_ts"));
        Instant latestIngest = toInstant(row.get("latest_ingest_ts"));

        eventLagSeconds.set(Duration.between(latestEvent, now).toSeconds());
        ingestLagSeconds.set(Duration.between(latestIngest, now).toSeconds());
    }

    private static Instant toInstant(Object value) {
        // Production code must handle nulls, timestamp precision, driver mapping,
        // and clock skew carefully.
        return ((Timestamp) value).toInstant();
    }
}
```

### Task 5: Alert Rules

Define alert thresholds:

```text
warning: event freshness > 2 minutes for 5 minutes
critical: event freshness > 10 minutes for 2 minutes
critical: table suspended = true
warning: DLQ > 0 for 10 minutes
critical: time_to_full < 24h
```

### Task 6: Runbook

For each alert, write:

```text
what it means
first 5 checks
owner
rollback/mitigation
expected recovery signal
```

---

## 22. Summary

QuestDB observability must be designed around the **time-series data flow**, not just server metrics.

The most important production signals are:

```text
ingestion success
producer retry/drop behavior
WAL/apply health
table suspension
freshness lag
query latency by class
storage growth/time-to-full
materialized view freshness
data quality anomalies
```

The most important shift in thinking:

```text
A time-series database is healthy only if fresh, correct, queryable data reaches users within the promised time window.
```

Not merely:

```text
QuestDB process is running.
```

A mature system makes freshness visible everywhere:

```text
operators see it in dashboards
alerts trigger on it
developers emit it from Java services
APIs return it to consumers
runbooks start from it
```

---

## 23. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-023.md
Failure Modes and Production Runbooks
```

Part 023 will go deeper into concrete incident scenarios:

```text
disk full
WAL suspended
slow WAL apply
bad producer causing schema pollution
hot partition overload
query memory blow-up
long-running dashboard query
O3 storm
clock skew
duplicate burst
corrupt/partial backfill
recovery decision tree
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-021.md">⬅️ Configuration Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-023.md">Failure Modes and Production Runbooks ➡️</a>
</div>

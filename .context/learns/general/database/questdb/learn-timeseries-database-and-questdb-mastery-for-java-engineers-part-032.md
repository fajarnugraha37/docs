# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-032.md

# Domain Case Study III: Observability Metrics and Application Signals

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `032`  
> Target pembaca: Java software engineer / tech lead / platform engineer  
> Fokus: memakai QuestDB sebagai time-series analytics store untuk observability metrics dan application signals tanpa salah memosisikannya sebagai pengganti total Prometheus, log store, atau tracing backend.

---

## 1. Tujuan Part Ini

Part ini membahas bagaimana mendesain sistem observability berbasis QuestDB untuk workload seperti:

- custom application metrics,
- service latency metrics,
- error-rate analytics,
- endpoint/API metrics,
- business-operational signals,
- SLO/SLA analytics,
- deployment/change correlation,
- tenant-level operational telemetry,
- regulatory/enforcement lifecycle signals,
- long-retention metrics analytics,
- dashboard analytics yang lebih fleksibel daripada metric backend standar.

Kita tidak akan mengulang teori observability dasar seperti "metrics vs logs vs traces" secara generic. Yang akan dibangun adalah mental model:

```text
QuestDB is useful when observability signals need SQL,
temporal joins, long-retention analytics, and custom rollups.
```

Tapi QuestDB bukan otomatis pengganti Prometheus, Grafana stack, OpenTelemetry collector, log search, atau tracing backend. Kesalahan paling umum adalah memperlakukan QuestDB sebagai "semua observability masuk sini", lalu cardinality meledak, query dashboard tidak bounded, dan alerting freshness tidak jelas.

---

## 2. Problem yang Sedang Diselesaikan

Di sistem Java production, observability sering tumbuh seperti ini:

```text
phase 1: app exposes metrics
phase 2: Prometheus scrapes
phase 3: Grafana dashboard
phase 4: logs masuk Elasticsearch/Loki
phase 5: traces masuk Jaeger/Tempo/vendor APM
phase 6: business butuh SQL analytics atas metrics
phase 7: retention Prometheus terlalu pendek atau query PromQL terlalu awkward
phase 8: custom aggregation, historical comparison, tenant analytics, and anomaly analysis become painful
```

Masalahnya bukan Prometheus buruk. Masalahnya adalah tool observability standar sering dioptimalkan untuk:

```text
fast operational alerting
near-real-time dashboard
time-series scrape model
label-based metric search
```

Sementara sebagian kebutuhan platform/engineering leadership membutuhkan:

```text
ad-hoc SQL analytics
multi-stream temporal correlation
longer retention
rollup hierarchy
tenant/customer/system dimension analysis
deployment-to-symptom analysis
business-process signal analytics
```

Di titik ini QuestDB bisa menjadi analytics layer yang sangat kuat.

---

## 3. Mental Model Utama

### 3.1 Observability Has Multiple Planes

Jangan mulai dari "pakai database apa". Mulai dari plane:

```text
instrumentation plane
  -> app emits signals

collection plane
  -> agent / collector / sidecar / gateway receives signals

alerting plane
  -> low-latency operational detection

analytics plane
  -> historical and exploratory analysis

serving plane
  -> dashboard/API/reporting

governance plane
  -> cardinality, retention, schema, access, cost
```

QuestDB paling cocok berada di:

```text
analytics plane
serving plane
long-retention metrics plane
custom operational telemetry plane
```

QuestDB tidak harus menggantikan:

```text
Prometheus alerting plane
OpenTelemetry collection plane
log search plane
distributed trace UI
```

### 3.2 QuestDB as Observability Analytics Store

Posisi yang sehat:

```text
applications / collectors
    -> Prometheus / OTel / log backend / tracing backend
    -> QuestDB analytics store
```

QuestDB dipakai untuk:

```text
SQL query over metrics
long-range historical analysis
pre-aggregated dashboard tables
tenant/service/endpoint trend analysis
temporal join with deployments/incidents
SLO burn-rate style analysis
custom platform health reporting
```

Bukan untuk:

```text
full text log search
span waterfall UI
high-cardinality raw trace events without curation
unbounded label explosion
sub-second alert fanout at massive scale without design
```

### 3.3 Signals Are Not All Equal

Observability signal categories:

```text
metric sample
  numeric value observed at time

event signal
  discrete occurrence, e.g. deployment, incident, error event

state signal
  service state, rollout state, circuit breaker state

derived signal
  precomputed rate, p95, burn rate, SLO window

log-derived signal
  count/ratio extracted from logs, not raw log text

trace-derived signal
  aggregate latency/error data extracted from spans, not raw span graph
```

QuestDB is strongest when the signal has:

```text
timestamp
bounded dimensions
numeric fields
clear series identity
queryable temporal semantics
```

---

## 4. What Not to Put in QuestDB

Before schema design, define exclusions.

### 4.1 Raw Logs

Raw logs usually have:

```text
large text payload
unbounded message shape
full-text search needs
high ingestion volume
retention/compression/search trade-offs
```

QuestDB can store text, but it is not a log search engine.

Better pattern:

```text
logs -> Loki/Elasticsearch/OpenSearch/vendor log backend
log-derived metrics -> QuestDB
```

Example log-derived metrics:

```text
error_count by service, endpoint, exception_class
timeout_count by downstream, tenant
validation_failure_count by rule_code
regulatory_case_transition_count by state, transition_type
```

### 4.2 Raw Distributed Traces

Raw spans have:

```text
trace_id
span_id
parent_id
attributes
events
links
duration
status
resource metadata
often high-cardinality labels
```

QuestDB can store span-derived facts, but raw trace exploration is better in tracing backend.

Better pattern:

```text
traces -> Tempo/Jaeger/vendor APM
trace-derived aggregates -> QuestDB
```

Example:

```text
service_endpoint_latency_1m
downstream_dependency_error_rate
critical_path_duration_by_workflow
workflow_stage_latency_by_case_type
```

### 4.3 Unbounded Labels

Common observability cardinality bombs:

```text
user_id
request_id
trace_id
session_id
email
ip_address
full URL with path params
exception message
SQL text
payload hash
free-form tenant custom label
```

These should usually not become `SYMBOL` dimensions.

---

## 5. Observability Data Modeling

### 5.1 Canonical Metric Sample

Basic shape:

```sql
CREATE TABLE app_metric_raw (
    ts TIMESTAMP,
    service SYMBOL,
    instance SYMBOL,
    env SYMBOL,
    region SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    metric_type SYMBOL,
    source SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

This shape is generic and flexible, but it has trade-offs:

Pros:

```text
easy to add new metric names
stable schema
works for many metrics
```

Cons:

```text
metric name becomes high-use dimension
different metrics share one value column
unit/type mistakes become runtime data quality problem
queries need metric filter
wide dashboards may need pivot-like logic
```

Good for:

```text
moderate metric variety
custom platform metrics
internal operational metrics
analytics workloads
```

Risky for:

```text
extremely high cardinality labels
very high volume with many dimensions
metrics that need strongly typed columns and fixed schema
```

### 5.2 Service Endpoint Metric

For HTTP/gRPC endpoint analytics:

```sql
CREATE TABLE endpoint_metric_raw (
    ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    instance SYMBOL,
    method SYMBOL,
    route SYMBOL,
    status_class SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    sample_count LONG,
    quality SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Important: use normalized route template:

```text
GOOD:
  /cases/{caseId}/actions
  /users/{userId}/sessions

BAD:
  /cases/CASE-928371/actions
  /users/729181/sessions
```

### 5.3 Latency Distribution Data

QuestDB can store pre-aggregated percentile values:

```sql
CREATE TABLE endpoint_latency_1m (
    bucket_ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    route SYMBOL,
    method SYMBOL,
    count LONG,
    p50_ms DOUBLE,
    p90_ms DOUBLE,
    p95_ms DOUBLE,
    p99_ms DOUBLE,
    max_ms DOUBLE,
    error_count LONG
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

But understand the correctness issue:

```text
percentile of percentiles is usually wrong
```

If you aggregate p95 from instances into service-level p95, you may get misleading results.

Better options:

```text
store histogram buckets
store sufficient distribution sketches upstream
store pre-aggregated percentiles only at the exact dimension level you serve
```

### 5.4 Histogram Bucket Model

For Prometheus-like histograms:

```sql
CREATE TABLE endpoint_latency_bucket_1m (
    bucket_ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    route SYMBOL,
    method SYMBOL,
    le DOUBLE,
    bucket_count LONG,
    total_count LONG,
    sum_ms DOUBLE
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

This lets you reconstruct approximate quantiles if you preserve bucket counts.

Trade-off:

```text
more rows
more complex query
better aggregation correctness
```

### 5.5 Error Event Aggregate

Instead of storing every exception log, store aggregates:

```sql
CREATE TABLE app_error_1m (
    bucket_ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    route SYMBOL,
    exception_class SYMBOL,
    error_code SYMBOL,
    count LONG,
    affected_tenant_count LONG
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

Avoid:

```text
exception_message as SYMBOL
stack_trace as column
request_id as dimension
```

### 5.6 Deployment Events

Deployment events are sparse but extremely valuable for temporal correlation:

```sql
CREATE TABLE deployment_event (
    ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    version SYMBOL,
    git_sha SYMBOL,
    deploy_id SYMBOL,
    actor SYMBOL,
    rollout_strategy SYMBOL,
    status SYMBOL
) TIMESTAMP(ts) PARTITION BY MONTH WAL;
```

Then correlate:

```text
error rate before/after deployment
latency before/after version change
incident symptoms by version
SLO burn rate around rollout
```

### 5.7 Incident Events

```sql
CREATE TABLE incident_event (
    ts TIMESTAMP,
    incident_id SYMBOL,
    service SYMBOL,
    env SYMBOL,
    severity SYMBOL,
    state SYMBOL,
    event_type SYMBOL,
    owner_team SYMBOL,
    summary VARCHAR
) TIMESTAMP(ts) PARTITION BY MONTH WAL;
```

Use carefully. `summary` is not a query dimension.

---

## 6. QuestDB Query Patterns for Observability

### 6.1 Latest Service Health

```sql
SELECT *
FROM service_health
LATEST ON ts PARTITION BY service, env, region;
```

Use case:

```text
current health dashboard
last reported heartbeat
latest dependency state
```

But define staleness:

```sql
SELECT
    service,
    env,
    region,
    ts,
    now() - ts AS age
FROM service_health
LATEST ON ts PARTITION BY service, env, region;
```

A latest row can be stale. "Latest" is not the same as "healthy".

### 6.2 Endpoint Error Rate

If stored as count aggregates:

```sql
SELECT
    bucket_ts,
    service,
    route,
    sum(error_count) AS errors,
    sum(total_count) AS requests,
    sum(error_count) * 1.0 / sum(total_count) AS error_rate
FROM endpoint_latency_1m
WHERE bucket_ts >= dateadd('h', -6, now())
  AND service = 'case-service'
SAMPLE BY 5m ALIGN TO CALENDAR;
```

Key invariant:

```text
error rate must be count-weighted
```

Do not average per-instance error rates blindly.

### 6.3 Latency Trend

```sql
SELECT
    bucket_ts,
    route,
    avg(p95_ms) AS avg_p95_ms
FROM endpoint_latency_1m
WHERE bucket_ts >= dateadd('d', -7, now())
  AND service = 'case-service'
SAMPLE BY 15m ALIGN TO CALENDAR;
```

Warning:

```text
avg(p95_ms) is an operational approximation, not a mathematically exact global p95.
```

For exact-ish aggregation, use histogram buckets.

### 6.4 Deployment Correlation with ASOF JOIN

```sql
SELECT
    m.bucket_ts,
    m.service,
    m.route,
    m.error_count,
    m.total_count,
    d.version,
    d.git_sha,
    d.deploy_id
FROM endpoint_latency_1m m
ASOF JOIN deployment_event d
ON m.service = d.service
WHERE m.bucket_ts >= dateadd('h', -12, now())
  AND m.service = 'case-service';
```

Mental model:

```text
For each metric bucket, attach latest deployment event at or before that bucket.
```

This is where QuestDB is especially useful compared to a plain metrics backend.

### 6.5 Incident Timeline Correlation

```sql
SELECT
    m.bucket_ts,
    m.service,
    sum(m.error_count) AS errors,
    sum(m.total_count) AS requests,
    i.incident_id,
    i.severity,
    i.state
FROM endpoint_latency_1m m
ASOF JOIN incident_event i
ON m.service = i.service
WHERE m.bucket_ts >= dateadd('d', -2, now())
  AND m.service = 'payment-service'
SAMPLE BY 5m;
```

This can power postmortem analytics.

---

## 7. SLO and Burn Rate Analytics

### 7.1 SLO Basic Model

For availability SLO:

```text
good events = requests not violating objective
bad events  = requests violating objective
total events = good + bad
error budget consumed = bad / allowed_bad
```

Store pre-aggregated events:

```sql
CREATE TABLE slo_event_1m (
    bucket_ts TIMESTAMP,
    slo_id SYMBOL,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    objective SYMBOL,
    good_count LONG,
    bad_count LONG,
    total_count LONG
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

### 7.2 Burn Rate Query

```sql
SELECT
    bucket_ts,
    slo_id,
    sum(bad_count) AS bad,
    sum(total_count) AS total,
    sum(bad_count) * 1.0 / sum(total_count) AS observed_error_rate
FROM slo_event_1m
WHERE bucket_ts >= dateadd('h', -1, now())
  AND slo_id = 'case-api-availability'
SAMPLE BY 5m ALIGN TO CALENDAR;
```

Burn rate requires comparing observed error rate to allowed error rate:

```text
allowed_error_rate = 1 - SLO target
burn_rate = observed_error_rate / allowed_error_rate
```

For 99.9% SLO:

```text
allowed_error_rate = 0.001
observed_error_rate = 0.01
burn_rate = 10x
```

### 7.3 Multi-Window SLO

You can store raw 1m aggregate and query multiple windows:

```text
5m fast burn
30m medium burn
6h slow burn
3d budget trend
```

QuestDB serving pattern:

```text
raw 1m table
  -> materialized view 5m
  -> materialized view 30m
  -> materialized view 1h
```

But define alerting carefully. Prometheus/alertmanager may still be better for operational paging. QuestDB can power:

```text
SLO investigation dashboard
error budget reporting
tenant-level SLO analytics
regulatory/reporting evidence
```

---

## 8. Cardinality Guardrails for Observability

### 8.1 Cardinality Budget

For each table:

```text
series identity = service × env × region × route × method × status_class × metric
```

Estimate:

```text
services = 80
envs = 4
regions = 5
routes per service = 100
methods = 5
status_class = 5
metrics = 20

max theoretical = 80 × 4 × 5 × 100 × 5 × 5 × 20
                = 16,000,000 series
```

But active cardinality may be lower. Still, design must set budgets.

### 8.2 Allowed vs Forbidden Dimensions

Usually allowed:

```text
service
env
region
route_template
method
status_class
dependency
exception_class
tenant_tier
workflow_type
```

Usually forbidden:

```text
user_id
request_id
trace_id
session_id
raw_url
stack_trace
sql_text
payload_key
free-form label
exception_message
```

Conditionally allowed:

```text
tenant_id
device_id
case_type
workflow_id
jurisdiction
customer_id
```

Conditional means:

```text
allowed only if query need is real,
cardinality is bounded,
access control is understood,
retention is justified,
and ingestion validates the value.
```

### 8.3 Java Cardinality Gate

Producer-side example:

```java
public final class MetricDimensionGuard {
    private static final Pattern ROUTE_TEMPLATE =
        Pattern.compile("^/[a-zA-Z0-9_{}\\-/]+$");

    public void validateEndpointMetric(EndpointMetric metric) {
        requireKnownService(metric.service());
        requireKnownEnv(metric.env());
        requireKnownRegion(metric.region());

        if (!ROUTE_TEMPLATE.matcher(metric.route()).matches()) {
            throw new InvalidMetricException("route must be normalized template");
        }

        if (looksLikeUuid(metric.route()) || containsNumericIdSegment(metric.route())) {
            throw new InvalidMetricException("route appears to contain raw id");
        }

        if (metric.extraLabels().containsKey("request_id")) {
            throw new InvalidMetricException("request_id is forbidden as dimension");
        }
    }
}
```

The key point is not the exact regex. The key point:

```text
observability cardinality must be enforced before data reaches QuestDB
```

---

## 9. Materialized Views for Dashboards

### 9.1 Why Dashboards Need Serving Tables

Raw observability tables often become large:

```text
metrics per service
× services
× instances
× routes
× regions
× retention window
```

A dashboard that runs raw scans every 5 seconds will harm the database.

Pattern:

```text
raw_metric_10s
  -> endpoint_metric_1m
  -> endpoint_metric_5m
  -> endpoint_metric_1h
```

### 9.2 Example Rollup

```sql
CREATE MATERIALIZED VIEW endpoint_metric_5m AS
SELECT
    bucket_ts,
    service,
    env,
    region,
    route,
    method,
    sum(total_count) AS total_count,
    sum(error_count) AS error_count,
    max(max_ms) AS max_ms
FROM endpoint_metric_1m
SAMPLE BY 5m;
```

For percentiles, do not roll up naive p95 unless you accept approximation.

Better:

```text
raw histogram bucket -> roll up bucket counts -> derive quantile for dashboard
```

### 9.3 Dashboard Query Contract

Dashboard query should always specify:

```text
time range
service/env/region filter
rollup level
max series count
max bucket count
```

Bad dashboard API:

```http
GET /metrics?metric=latency
```

Better:

```http
GET /metrics/latency?
  service=case-service&
  env=prod&
  region=ap-southeast-1&
  from=2026-06-21T00:00:00Z&
  to=2026-06-21T06:00:00Z&
  step=5m&
  groupBy=route
```

---

## 10. OpenTelemetry Integration Mental Model

QuestDB is not usually the collector. Use an ingestion gateway or collector pipeline.

Possible architecture:

```text
Java apps
  -> OpenTelemetry SDK
  -> OpenTelemetry Collector
  -> Prometheus / tracing backend / log backend
  -> custom exporter or stream
  -> QuestDB ingestion service
```

Alternative:

```text
Java apps
  -> Micrometer
  -> Prometheus endpoint
  -> scraper/bridge
  -> QuestDB
```

Or:

```text
Java apps
  -> internal metric event topic
  -> Kafka
  -> QuestDB ingestion service
```

Decision:

```text
If operational alerting is primary:
  keep Prometheus first.

If SQL analytics and long retention are primary:
  add QuestDB analytics path.

If both:
  dual-write carefully through collector/gateway, not random app-level duplication.
```

---

## 11. Java Instrumentation Patterns

### 11.1 Micrometer to QuestDB Directly?

Possible, but be careful.

Risks:

```text
every app becomes database client
config/secrets spread across services
backpressure leaks into business request path
metric failure affects application behavior
schema/cardinality governance decentralized
```

Better:

```text
app emits metrics to local/central collector
collector/gateway owns QuestDB ingestion
```

If direct write is used:

```text
must be async
must be bounded
must drop or degrade safely
must never block business request path indefinitely
must enforce dimension guardrails
```

### 11.2 Ingestion Gateway Pattern

```text
Java apps / collectors
  -> metric-gateway
  -> validation
  -> normalization
  -> batching
  -> QuestDB ILP
  -> DLQ for invalid metric envelopes
```

Gateway responsibilities:

```text
reject bad labels
normalize route templates
map metric names to schema
enforce unit and metric type
batch by table/time
implement retry and circuit breaker
expose ingestion freshness metrics
```

### 11.3 Metric Envelope

```java
public record MetricEnvelope(
    Instant eventTime,
    String service,
    String env,
    String region,
    String metricName,
    MetricType metricType,
    String unit,
    Map<String, String> dimensions,
    double value,
    long observedCount
) {}
```

Validation:

```text
eventTime required
service known
env known
metricName registered
unit compatible
dimensions bounded
value finite
observedCount non-negative
```

### 11.4 Do Not Block Request Path

Bad pattern:

```java
controller handles request
  -> writes metric synchronously to QuestDB
  -> waits for flush
  -> returns response
```

Better:

```java
controller handles request
  -> records metric into local meter/queue
  -> request completes
background exporter/gateway handles QuestDB ingestion
```

Observability failure must not become product outage unless explicitly required.

---

## 12. Regulatory / Enforcement Lifecycle Signals

Given systems with enforcement lifecycle/case management, observability can include domain-operational metrics:

```text
case intake rate
case transition count
queue depth by state
aging cases by escalation level
SLA breach count
manual override count
appeal submission count
review latency
evidence upload failure count
notification delivery latency
```

These are not pure infrastructure metrics. They are operational process signals.

Example table:

```sql
CREATE TABLE workflow_metric_1m (
    bucket_ts TIMESTAMP,
    system SYMBOL,
    jurisdiction SYMBOL,
    case_type SYMBOL,
    workflow SYMBOL,
    state SYMBOL,
    transition SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    count LONG
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

Use cases:

```text
detect enforcement backlog
measure escalation latency
correlate deployment to processing delay
compare jurisdictions
audit operational health over time
```

Important distinction:

```text
operational metric is not the source-of-record case event
```

The source of record remains OLTP/event-sourced system. QuestDB stores queryable time-series projection.

---

## 13. Alerting Strategy

### 13.1 QuestDB for Alerting?

QuestDB can support alert-like queries, but decide carefully.

Good use:

```text
analytics-backed alerts
slow-burn SLO analytics
business process anomaly detection
freshness reporting
scheduled health reports
```

Less ideal as sole alerting system:

```text
sub-second paging
huge number of alert rules
complex alert state management
dedup/silence/routing/escalation
```

For paging, Prometheus/Alertmanager or dedicated alerting system often remains better.

### 13.2 Alert Query Invariants

Every alert query must define:

```text
time window
evaluation frequency
freshness tolerance
missing-data behavior
threshold
grouping
dedup key
owner
runbook link
```

Missing data policy examples:

```text
No data means healthy?
No data means unknown?
No data means failing?
No data means ingestion broken?
```

For observability metrics, missing data is often a signal itself.

### 13.3 Freshness Alert

```sql
SELECT
    service,
    max(ts) AS last_seen,
    now() - max(ts) AS age
FROM app_metric_raw
WHERE ts >= dateadd('h', -1, now())
GROUP BY service;
```

But for production, use a heartbeat table:

```sql
CREATE TABLE service_heartbeat (
    ts TIMESTAMP,
    service SYMBOL,
    env SYMBOL,
    region SYMBOL,
    instance SYMBOL,
    version SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Then:

```sql
SELECT *
FROM service_heartbeat
LATEST ON ts PARTITION BY service, env, region, instance;
```

---

## 14. Query API Design for Observability

### 14.1 Bounded API

Expose bounded query endpoints, not raw SQL.

Example:

```java
public record MetricQuery(
    String service,
    String env,
    String region,
    Instant from,
    Instant to,
    Duration step,
    List<String> groupBy,
    String metric
) {}
```

Validation:

```text
from/to required
range <= allowed max for requested granularity
step >= minimum
groupBy from allowlist
metric from registry
series count estimated
tenant access checked
```

### 14.2 Query Source Routing

```text
range <= 6h and step <= 10s:
  raw or 10s table

range <= 7d and step >= 1m:
  1m rollup

range <= 90d and step >= 1h:
  1h rollup

historical report:
  cold/Parquet/rollup table
```

### 14.3 Result Size Guard

Estimate:

```text
bucket_count = range / step
series_count = estimated group combinations
result_rows = bucket_count × series_count
```

Reject or degrade when:

```text
result_rows too large
series_count too high
range too wide
query source too raw
```

---

## 15. Failure Modes

### 15.1 Cardinality Explosion

Symptoms:

```text
symbol dictionary growth
memory pressure
query latency increases
dashboard returns too many series
storage grows unexpectedly
```

Causes:

```text
raw URL used as route
tenant custom label allowed
request_id accidentally included
exception_message used as dimension
new service emits dynamic metric names
```

Mitigation:

```text
block bad producer
quarantine table
stop ingestion gateway route
drop/rename polluted dimensions where possible
add validation rule
backfill cleaned aggregate
review producer contract
```

### 15.2 Metrics Affect Business Path

Symptoms:

```text
request latency spikes when QuestDB slows
application thread pool exhaustion
increased error rate during observability outage
```

Cause:

```text
synchronous metric write in request path
unbounded metric queue
retry storm
```

Mitigation:

```text
make metric publishing async
bound buffers
drop non-critical metrics under pressure
circuit break QuestDB writer
separate observability failure from product availability
```

### 15.3 Dashboard Query Storm

Symptoms:

```text
CPU high
disk read high
query latency high
many concurrent range scans
```

Causes:

```text
dashboard auto-refresh too aggressive
raw table queried for long range
too many groupBy dimensions
no query guardrail
```

Mitigation:

```text
route to rollups
limit range/groupBy
cache at API layer if appropriate
add materialized views
rate-limit dashboard users
```

### 15.4 Incorrect SLO Math

Symptoms:

```text
reported SLO differs from Prometheus/APM
executives see wrong availability
alert mismatches reality
```

Causes:

```text
averaging percentages
percentile of percentiles
missing-data treated incorrectly
wrong denominator
double-counted retries
```

Mitigation:

```text
store counts, not only rates
use weighted aggregation
document missing-data policy
test against known examples
compare with source system
```

### 15.5 Missing Data Misread as Healthy

Symptoms:

```text
dashboard flatlines at zero
alert stops firing during ingestion outage
latest row old but displayed as current
```

Mitigation:

```text
track freshness separately
show stale markers
alert on heartbeat age
treat no data explicitly
```

---

## 16. Anti-Patterns

### Anti-Pattern 1: QuestDB as Dumping Ground for All Telemetry

Bad:

```text
logs, traces, metrics, audit payloads, request bodies, stack traces all into QuestDB
```

Better:

```text
specialized stores for raw signals
QuestDB for curated time-series analytics and derived metrics
```

### Anti-Pattern 2: High-Cardinality Labels as Symbols

Bad:

```text
trace_id SYMBOL
request_id SYMBOL
raw_url SYMBOL
```

Better:

```text
trace_id in tracing backend
request_id in logs/traces
route_template SYMBOL
status_class SYMBOL
```

### Anti-Pattern 3: Direct Metric Writes from Every App to QuestDB

Bad when unmanaged:

```text
hundreds of services directly write arbitrary metrics to QuestDB
```

Better:

```text
collector/gateway validates and normalizes metrics
```

### Anti-Pattern 4: Unbounded Dashboard SQL

Bad:

```text
SELECT * FROM app_metric_raw WHERE metric = 'latency';
```

Better:

```text
bounded query API
rollup source selection
range and groupBy limits
```

### Anti-Pattern 5: Percentile Rollups Without Distribution Data

Bad:

```text
daily_p95 = avg(minute_p95)
```

Better:

```text
histogram buckets or sketches
or explicitly label approximation
```

---

## 17. Testing Strategy

### 17.1 Cardinality Contract Test

Test that producers cannot emit forbidden labels:

```java
@Test
void rejectsRequestIdAsMetricDimension() {
    MetricEnvelope metric = validMetric()
        .withDimension("request_id", UUID.randomUUID().toString());

    assertThrows(InvalidMetricException.class,
        () -> guard.validate(metric));
}
```

### 17.2 Query Correctness Test

Use synthetic data:

```text
10 buckets
known total_count
known error_count
known deployment event
known expected ASOF correlation
```

Validate:

```text
error rate is weighted
missing bucket behavior
deployment join correctness
freshness logic
```

### 17.3 Load Test

Simulate:

```text
normal metric volume
route cardinality
instance churn
burst during incident
dashboard refresh concurrency
late metric delivery
```

Measure:

```text
ingestion throughput
WAL lag
query p95/p99
API response rows
dashboard load
disk growth
```

### 17.4 Chaos Test

Induce:

```text
QuestDB unavailable
slow disk
WAL lag
ingestion gateway queue full
bad producer emits dynamic label
dashboard storm
```

Expected behavior:

```text
business service remains healthy
metrics degrade safely
alerts detect freshness issue
bad metric source is isolated
```

---

## 18. Production Reference Architecture

A healthy QuestDB observability analytics architecture:

```text
Java services
  -> Micrometer / OpenTelemetry SDK
  -> collector or metric gateway
      -> label normalization
      -> cardinality guard
      -> unit/type registry
      -> batching
      -> retry/circuit breaker
      -> DLQ
  -> QuestDB raw/rollup tables
      -> materialized views
      -> retention/TTL
      -> monitoring
  -> Java observability API
      -> bounded query templates
      -> rollup routing
      -> access control
      -> result-size guard
  -> Grafana/internal dashboards/reports
```

Parallel systems:

```text
Prometheus/Alertmanager for core paging
log backend for raw logs
tracing backend for span exploration
QuestDB for SQL analytics and long-retention time-series
```

---

## 19. Production Checklist

### Signal Modeling

- [ ] Signals classified as metric/event/state/derived.
- [ ] Raw logs excluded unless intentionally summarized.
- [ ] Raw spans excluded unless intentionally projected.
- [ ] Metric names registered.
- [ ] Units defined.
- [ ] Metric type defined: gauge/counter/rate/distribution/etc.
- [ ] Timestamp semantics documented.

### Cardinality

- [ ] Series identity defined per table.
- [ ] Dimension allowlist exists.
- [ ] Forbidden labels rejected.
- [ ] Route templates normalized.
- [ ] Theoretical cardinality estimated.
- [ ] Active cardinality monitored.
- [ ] Producer contract tests exist.

### Ingestion

- [ ] Ingestion is async/bounded.
- [ ] Business request path does not block on QuestDB.
- [ ] Gateway/collector owns validation.
- [ ] Retry policy defined.
- [ ] DLQ exists for invalid metrics.
- [ ] Freshness metrics exposed.
- [ ] Backpressure behavior tested.

### Query and Dashboard

- [ ] No raw unbounded SQL exposed to users.
- [ ] API enforces time range.
- [ ] API enforces groupBy allowlist.
- [ ] Rollup routing exists.
- [ ] Result-size guard exists.
- [ ] Dashboard refresh interval controlled.
- [ ] Materialized views used for hot dashboards.

### SLO / Reporting

- [ ] Counts stored for weighted aggregation.
- [ ] Percentile rollup semantics documented.
- [ ] Missing-data policy defined.
- [ ] Freshness shown separately from value.
- [ ] Query result validated against source system.

### Operations

- [ ] WAL lag monitored.
- [ ] Disk growth monitored.
- [ ] Table freshness monitored.
- [ ] Cardinality growth monitored.
- [ ] Query latency by query class monitored.
- [ ] Bad producer isolation runbook exists.
- [ ] Dashboard storm runbook exists.

---

## 20. Final Mental Model

Observability data is dangerous because it looks harmless:

```text
just metrics
just labels
just dashboards
```

But production reality is:

```text
labels become cardinality
cardinality becomes memory/storage/query cost
query cost becomes dashboard latency
dashboard latency becomes operational blindness
missing data becomes false confidence
wrong rollup math becomes wrong decision
```

QuestDB can be an excellent observability analytics store when used with discipline:

```text
curated signals
bounded dimensions
clear timestamp semantics
rollup hierarchy
SQL-friendly analytics
freshness-aware dashboards
separation from raw logs/traces
```

The strongest architecture is not "QuestDB replaces everything". It is:

```text
Prometheus/logs/traces for operational observability primitives
QuestDB for SQL-based, long-retention, time-series analytics
```

That distinction keeps the system powerful without turning it into an ungoverned telemetry swamp.

---

## Ringkasan

Di part ini kita membahas:

- posisi QuestDB dalam observability architecture,
- kenapa QuestDB cocok sebagai analytics/serving layer,
- kenapa raw logs/traces biasanya tidak cocok,
- data modeling untuk app metrics, endpoint metrics, latency buckets, errors, deployments, incidents,
- SLO/burn-rate analytics,
- cardinality guardrails,
- materialized views untuk dashboard,
- OpenTelemetry/Micrometer integration mental model,
- Java ingestion gateway pattern,
- regulatory/enforcement lifecycle operational signals,
- alerting constraints,
- failure modes dan anti-pattern,
- production checklist.

Part berikutnya adalah penutup seri:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-033.md
Architecture Review, Decision Framework, and Production Checklist
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Domain Case Study II: Industrial IoT / Telemetry Platform</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-033.md">Part 033 — Architecture Review, Decision Framework, and Production Checklist ➡️</a>
</div>

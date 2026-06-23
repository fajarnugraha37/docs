# learn-go-logging-observability-profiling-troubleshooting-part-028.md

# Part 028 — Observability Cost, Cardinality, and Data Governance

> Seri: `learn-go-logging-observability-profiling-troubleshooting`  
> Bagian: `028 / 032`  
> Fokus: observability cost, cardinality, telemetry governance, PII/secrets, retention, sampling, redaction, ownership  
> Target pembaca: Java software engineer / tech lead yang ingin membangun observability Go yang scalable, aman, dan tidak menjadi sumber incident/cost explosion

---

## 0. Posisi Bagian Ini dalam Seri

Part sebelumnya membahas:

- logging design,
- metrics mental model,
- Prometheus instrumentation,
- OpenTelemetry,
- tracing,
- pprof,
- runtime metrics,
- Kubernetes observability,
- alerting/SLO,
- dashboard design.

Bagian ini membahas sisi yang sering terlambat dipikirkan:

```text
observability cost
cardinality
data governance
security/privacy
retention
sampling
ownership
```

Karena observability bukan gratis.

Telemetry bisa membantu incident, tetapi juga bisa menjadi masalah:

- storage cost meledak,
- query lambat,
- Prometheus overload,
- log pipeline bottleneck,
- trace backend mahal,
- high-cardinality labels membuat TSDB collapse,
- PII bocor ke logs,
- secrets tersimpan di traces,
- debug logs membanjiri production,
- telemetry exporter makan memory,
- metric schema berubah tanpa ownership,
- dashboard dan alert menjadi tidak dipercaya.

---

## 1. Core Thesis

**Observability yang tidak digovern akan berubah dari asset menjadi liability.**

Observability sehat punya tiga kualitas:

```text
useful
affordable
safe
```

Jika telemetry useful tapi terlalu mahal, ia tidak sustainable.

Jika telemetry murah tapi tidak menjawab incident, ia tidak berguna.

Jika telemetry useful dan murah tapi membocorkan PII/secret, ia berbahaya.

Target engineer top-tier bukan "emit semua data".

Targetnya:

```text
Emit the right data, with the right shape, at the right cardinality, with the right retention, for the right operational decisions.
```

---

## 2. The Observability Cost Model

Telemetry cost biasanya berasal dari:

### 2.1 Metrics

- number of active time series,
- scrape interval,
- histogram bucket count,
- label cardinality,
- retention duration,
- remote write,
- query complexity,
- recording rules.

### 2.2 Logs

- log volume,
- log size,
- JSON field count,
- retention,
- indexing fields,
- query frequency,
- ingestion pipeline,
- compression,
- duplicated logs.

### 2.3 Traces

- span volume,
- sampling rate,
- attributes/events per span,
- retention,
- indexing attributes,
- tail sampling cost,
- exporter queue/batch settings.

### 2.4 Profiles

- continuous profiling volume,
- sample rate,
- retention,
- symbolization,
- profile labels,
- storage backend.

### 2.5 Runtime Impact

- CPU to encode logs/spans/metrics,
- allocation overhead,
- lock contention,
- network egress,
- exporter memory queue,
- backpressure,
- dropped telemetry.

Observability cost is both infrastructure cost and application overhead.

---

## 3. Cardinality Mental Model

Cardinality is the number of distinct values a label/field can take.

In metrics, cardinality multiplies.

Example metric:

```text
http_requests_total{service, route, method, status}
```

If:

```text
service = 20
route = 100
method = 5
status = 10
```

Potential time series:

```text
20 * 100 * 5 * 10 = 100,000
```

Add `user_id` with 1,000,000 users:

```text
100,000 * 1,000,000 = 100,000,000,000
```

This is catastrophic.

---

## 4. Cardinality Explosion

Cardinality explosion happens when labels include unbounded values.

Bad metric labels:

```text
user_id
request_id
session_id
email
ip_address
raw_url
raw_path_with_id
query_string
order_id
tenant_id if unbounded/high-volume without control
error_message
stack_trace
pod_uid when not needed at app metric level
```

Safer labels:

```text
service
environment
route_template
method
status_class
error_class
dependency
operation
region
version
```

Cardinality-safe route:

```text
/orders/{id}
```

Dangerous raw path:

```text
/orders/123456789
```

---

## 5. Metrics Cardinality: Why It Hurts More

Metrics TSDB stores time series per unique label set.

High cardinality causes:

- memory pressure,
- slow queries,
- high ingestion CPU,
- high storage,
- remote write pressure,
- Prometheus OOM,
- alert query timeouts,
- dashboard slowdowns,
- dropped samples.

Logs can tolerate high-cardinality fields better if not indexed aggressively.

Metrics cannot.

Rule:

```text
Never put unbounded identifiers in metric labels.
```

---

## 6. Histogram Cost

Histogram creates multiple time series per label set.

If histogram has 15 buckets, Prometheus style often creates:

```text
bucket series + sum + count
```

Roughly:

```text
17 series per label set
```

Metric:

```text
http_request_duration_seconds_bucket{route,method,status}
```

If 100 routes * 5 methods * 5 statuses * 17:

```text
42,500 series
```

Add dependency operation/cardinality carelessly and cost grows fast.

Histogram bucket design matters.

---

## 7. Label Budgeting

For important metrics, define label budget.

Example HTTP server metric:

```text
Allowed labels:
- service
- environment
- route_template
- method
- status_class
```

Not allowed:

```text
- user_id
- request_id
- raw_path
- query
- error message
```

Example dependency metric:

```text
Allowed:
- dependency
- operation
- status_class
- error_class
```

Example worker metric:

```text
Allowed:
- job_type
- status
- queue
```

Govern labels like API contracts.

---

## 8. Route Template Discipline

Bad:

```go
labels := prometheus.Labels{
	"path": r.URL.Path,
}
```

Good:

```go
labels := prometheus.Labels{
	"route": routeTemplate, // "/orders/{id}"
}
```

Framework/router should expose route pattern.

If not available:

- set route manually in middleware,
- wrap handlers with known route,
- avoid raw path,
- group unknown route as `"unknown"`.

Raw path metrics are one of the most common cardinality incidents.

---

## 9. Error Classification Discipline

Bad:

```go
errors_total{error="dial tcp 10.1.2.3:5432: i/o timeout"}
```

Good:

```go
errors_total{error_class="dependency_timeout", dependency="postgres"}
```

Error class examples:

```text
validation_failed
auth_failed
permission_denied
dependency_timeout
dependency_5xx
dependency_rate_limited
db_deadlock
db_unique_violation
context_cancelled
context_deadline
panic_recovered
queue_full
internal_bug
```

Keep raw error message in logs, not metric labels.

---

## 10. Logs: High Cardinality Is Not Free Either

Logs can store high-cardinality fields, but indexing them can be expensive.

Safe log fields:

```text
trace_id
request_id
user_id
order_id
tenant_id
```

Maybe useful for search.

But policy matters:

- should they be indexed?
- are they PII?
- retention duration?
- access control?
- redaction?
- legal constraints?
- query cost?

Do not treat logs as free blob storage.

---

## 11. Logs Volume Control

Log cost grows with:

```text
event_count * event_size * retention * index_factor
```

Bad patterns:

- logging every item in batch,
- logging full payload,
- logging repeated retry error at every layer,
- debug logs in production,
- duplicate logs at each stack layer,
- access logs with huge headers,
- log storm during dependency outage.

Control methods:

1. log levels,
2. sampling,
3. deduplication,
4. log once at boundary,
5. field size limits,
6. event taxonomy,
7. dynamic log level with expiration,
8. separate audit logs from debug logs.

---

## 12. Trace Cost Control

Trace cost grows with:

- spans per request,
- sampling rate,
- span attributes,
- span events,
- span links,
- high-cardinality indexed attributes,
- retention.

Bad tracing:

```text
span per loop item
span per DB row
full request payload as attribute
user_id indexed everywhere
events for every retry internal detail without sampling
```

Good tracing:

- span per meaningful operation,
- attributes bounded,
- high-cardinality data not indexed or omitted,
- sampling appropriate,
- error traces retained,
- tail sampling for rare failures,
- span events for important milestones.

---

## 13. Sampling Strategies

### 13.1 Head Sampling

Decision made at trace start.

Pros:

- simple,
- low overhead downstream.

Cons:

- may miss rare errors/tail latency.

### 13.2 Tail Sampling

Decision after observing trace.

Pros:

- keep errors/slow traces,
- better for incident debugging.

Cons:

- more collector memory/CPU,
- needs buffering,
- delayed decision,
- operational complexity.

### 13.3 Log Sampling

Useful for repeated events.

Example:

```text
sample repeated dependency timeout logs after first N per minute
```

But do not sample:

- audit logs,
- security events,
- financial transaction logs,
- rare critical errors without care.

### 13.4 Metrics Sampling

Usually avoid sampling metrics that feed SLOs.

SLO metrics should be complete or carefully aggregated.

---

## 14. Redaction and Data Classification

Telemetry may contain sensitive data.

Classes:

| Class | Examples | Handling |
|---|---|---|
| Public | service name, route template | normal |
| Internal | pod, node, deployment version | internal access |
| Confidential | business IDs, tenant IDs | restricted/index policy |
| PII | name, email, phone, address, national ID | avoid or redact |
| Secrets | tokens, passwords, API keys, cookies | never log/trace |
| Regulated | financial/health/legal data | strict policy |

Rule:

```text
Secrets must not enter telemetry.
PII should be avoided unless explicitly justified and protected.
```

---

## 15. Common Secret Leak Sources

- Authorization header,
- Cookie header,
- Set-Cookie,
- API key query parameter,
- OAuth token,
- database URL with password,
- DSN,
- S3 signed URL,
- private key,
- JWT,
- session ID,
- CSRF token,
- password reset token,
- webhook secret.

Do not log headers wholesale.

Bad:

```go
logger.Info("request", "headers", r.Header)
```

Better:

```go
logger.Info("request",
	"method", r.Method,
	"route", route,
	"user_agent_class", classifyUserAgent(r.UserAgent()),
)
```

---

## 16. Redaction in `slog`

Use `LogValuer` for sensitive types.

```go
type SecretString string

func (s SecretString) LogValue() slog.Value {
	return slog.StringValue("[REDACTED]")
}
```

Use `ReplaceAttr` to redact known keys.

```go
opts := &slog.HandlerOptions{
	ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
		switch strings.ToLower(a.Key) {
		case "password", "token", "authorization", "cookie", "secret":
			return slog.String(a.Key, "[REDACTED]")
		default:
			return a
		}
	},
}
```

But redaction by key is not enough.

Design APIs so secrets are not passed to logger at all.

---

## 17. Trace Attribute Redaction

Do not set:

```text
authorization token
cookie
full request body
email
phone
raw address
full URL with query secrets
```

Prefer:

```text
route template
status code
error class
tenant tier
payload size bucket
dependency operation
retry attempt
```

If you need correlation with user/customer, consider:

- hashed ID,
- internal ID with strict access,
- not indexed,
- short retention,
- explicit policy.

---

## 18. Metrics and PII

Metrics labels should almost never contain PII.

Bad:

```text
login_attempts_total{email="user@example.com"}
```

Bad:

```text
request_duration_seconds{user_id="123"}
```

Good:

```text
login_attempts_total{result="failed", reason="bad_password"}
```

If per-tenant metrics are needed:

- limit tenant cardinality,
- aggregate tiers,
- use allowlisted enterprise tenants,
- separate billing/analytics pipeline if needed,
- do not put arbitrary tenant ID everywhere.

---

## 19. Retention Strategy

Different telemetry needs different retention.

Example:

| Data | Hot Retention | Long Retention |
|---|---:|---:|
| SLO metrics | 30–90 days | aggregated 1 year |
| high-cardinality debug metrics | short | none |
| application logs | 7–30 days | selected archive |
| audit logs | policy-driven | longer, immutable |
| traces | 3–14 days | sampled/selected |
| profiles | 7–30 days | selected incidents |
| incident artifacts | long | curated |

Do not keep all raw telemetry forever.

---

## 20. Indexing Strategy

Indexing everything is expensive.

Logs:

- index service, env, level, error_class, trace_id.
- maybe route, status.
- avoid indexing full message, user ID, raw path unless justified.

Traces:

- index service, operation, status, error, route, dependency.
- avoid indexing high-cardinality raw IDs unless necessary.

Metrics:

- labels are indexes by nature; keep safe.

---

## 21. Ownership

Telemetry must have owners.

For each metric/log/span:

```text
owner team
purpose
retention
cardinality expectation
SLO relation
dashboard/alert usage
deprecation policy
```

Unowned telemetry becomes clutter and cost.

Questions for any new metric:

```text
Who will use it?
Which dashboard/alert?
What labels?
Expected cardinality?
Retention?
What action will it support?
```

---

## 22. Telemetry Schema Governance

Define naming conventions:

### Metrics

```text
http_server_requests_total
http_server_request_duration_seconds
dependency_requests_total
dependency_request_duration_seconds
queue_depth
queue_submit_wait_duration_seconds
```

### Logs

Common fields:

```text
timestamp
level
service
version
trace_id
request_id
event
error_class
route
dependency
duration_ms
```

### Traces

Common attributes:

```text
service.name
service.version
http.route
http.response.status_code
error.type
dependency.name
operation.name
```

Consistency makes dashboards and alerts reusable.

---

## 23. Metric Lifecycle

Metrics need lifecycle management.

Stages:

1. proposed,
2. implemented,
3. documented,
4. used in dashboard/alert,
5. stable,
6. deprecated,
7. removed.

Do not break dashboards by renaming metrics casually.

For breaking changes:

- dual emit for transition,
- update dashboards/alerts,
- communicate,
- remove old metric after retention window.

---

## 24. Observability Review in PRs

Add checklist to PR review:

```text
[ ] Any new logs?
[ ] Any PII/secret risk?
[ ] Any new metrics?
[ ] Label cardinality safe?
[ ] Any new spans?
[ ] Span attributes bounded?
[ ] Error classes stable?
[ ] Dashboard/alert updated?
[ ] Log volume acceptable?
[ ] Telemetry cost considered?
[ ] Tests cover redaction?
```

Observability changes are production changes.

---

## 25. Cardinality Testing

You can test labels.

Example:

```go
func TestRouteMetricDoesNotUseRawPath(t *testing.T) {
	// Hit /orders/1, /orders/2, /orders/3
	// Assert metric label route="/orders/{id}" not raw paths.
}
```

For custom metrics, unit test allowed labels.

For logs, test redaction:

```go
func TestSecretRedactedInLogs(t *testing.T) {
	// emit log with token
	// assert token value absent
	// assert [REDACTED] present
}
```

---

## 26. Telemetry Budget

Set budgets.

Examples:

```text
Logs:
- normal: <= 2KB/request at INFO for checkout
- error storm: <= 100 logs/sec per pod after sampling

Metrics:
- service active series <= 50k
- per metric cardinality documented
- no raw path labels

Traces:
- head sample 5% normal traffic
- keep 100% error traces via tail sampling
- max span attributes per span
```

Budgets make trade-offs explicit.

---

## 27. Observability Cost Dashboard

Monitor observability itself.

Panels:

- log ingestion bytes/sec by service,
- log count/sec by level,
- trace spans/sec by service,
- metrics active series by service,
- top cardinality labels,
- Prometheus scrape samples/sec,
- remote write queue,
- dropped logs/spans/metrics,
- collector CPU/memory,
- exporter queue size,
- telemetry error rate.

Observability pipeline is production infrastructure.

---

## 28. Incident: Metrics Cardinality Explosion

### Symptom

- Prometheus memory spikes.
- scrape slow.
- dashboards timeout.
- remote write backlog grows.

Root cause:

```go
requests.WithLabelValues(r.URL.Path, userID, status).Inc()
```

Impact:

- millions of time series,
- TSDB memory pressure,
- monitoring degraded during incident.

Fix:

- remove userID/raw path labels,
- route template,
- block bad metric,
- delete stale series if needed,
- add lint/review.

Prevention:

- metric label allowlist,
- cardinality dashboard,
- CI test,
- code review checklist.

---

## 29. Incident: Log Cost Explosion

### Symptom

- logging bill 10x.
- app CPU increases.
- log pipeline lag.
- p99 latency worsens.

Cause:

- debug log enabled in production,
- logs full request/response payload,
- error retry logs at every attempt.

Fix:

- disable debug,
- sample repeated errors,
- remove payload logging,
- log once at boundary,
- add log volume alert.

Prevention:

- dynamic log level expiration,
- log budget,
- PR review,
- redaction tests.

---

## 30. Incident: Trace Backend Overload

### Symptom

- trace backend ingestion overload.
- app exporter queue grows.
- memory rises.
- spans dropped.

Cause:

- span per item in batch job,
- 100k items per request,
- no sampling,
- huge span events.

Fix:

- aggregate item processing as metrics,
- span per stage,
- sample,
- cap events,
- exporter queue limit.

Lesson:

Tracing is for causality, not per-row analytics.

---

## 31. Incident: PII Leak in Logs

### Symptom

- email and national ID appear in application logs.

Cause:

- error log includes full request DTO.
- logger serializes struct automatically.

Fix:

- remove DTO logging,
- add `LogValuer` redaction,
- scrub stored logs according to policy,
- notify security/privacy process,
- add tests.

Prevention:

- no full object logging,
- sensitive type wrappers,
- code review checklist,
- log scanning.

---

## 32. Data Governance Runbook

```text
Runbook: Telemetry governance incident

1. Classify incident
   - cost spike?
   - cardinality spike?
   - PII/secret leak?
   - pipeline overload?
   - dropped telemetry?

2. Scope
   - service:
   - telemetry type:
   - metric/log/span:
   - start time:
   - volume/cardinality:
   - sensitive data involved?

3. Mitigate
   - disable offending telemetry
   - reduce sampling/log level
   - block/drop at collector
   - remove label
   - rollback
   - restrict access if sensitive
   - notify security/privacy if needed

4. Recover
   - verify pipeline stable
   - verify dashboards/alerts
   - clean up stale series/index if needed
   - rotate secrets if leaked

5. Prevent
   - tests
   - lint/rules
   - review checklist
   - budget alert
   - documentation
```

---

## 33. Governance Policy Example

```text
Telemetry Policy

Metrics:
- No PII/secrets in labels.
- No raw path labels.
- All labels must be bounded.
- New histograms require bucket review.
- Metrics used for SLO must be stable.

Logs:
- No secrets.
- No full request/response body in production logs.
- PII requires documented justification and restricted access.
- Error logs use error_class.
- Debug logs in production require expiry.

Traces:
- No secrets or payload bodies in attributes/events.
- Span cardinality controlled.
- Sampling policy documented.
- Error/slow traces prioritized.

Profiles:
- Production profiles stored securely.
- Artifacts named with service/version/time.
- Profiles may contain sensitive stack/function info; access controlled.
```

---

## 34. Go Implementation Patterns

### 34.1 Central Logger Package

Provide logger constructors with redaction default.

```go
func NewLogger(w io.Writer, level slog.Leveler) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: redactAttr,
	})
	return slog.New(handler)
}
```

### 34.2 Metric Label Constants

Avoid ad-hoc labels everywhere.

```go
const (
	LabelService    = "service"
	LabelRoute      = "route"
	LabelMethod     = "method"
	LabelStatus     = "status_class"
	LabelDependency = "dependency"
	LabelOperation  = "operation"
	LabelErrorClass = "error_class"
)
```

### 34.3 Error Classifier

```go
func ClassifyError(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "context_deadline"
	case errors.Is(err, context.Canceled):
		return "context_cancelled"
	case errors.Is(err, ErrQueueFull):
		return "queue_full"
	default:
		return "internal"
	}
}
```

### 34.4 Safe Attributes

```go
func SafeHTTPAttrs(route, method string, status int) []slog.Attr {
	return []slog.Attr{
		slog.String("route", route),
		slog.String("method", method),
		slog.Int("status", status),
		slog.String("status_class", statusClass(status)),
	}
}
```

---

## 35. OpenTelemetry Governance

Centralize OTel configuration:

- resource attributes,
- sampler,
- exporter,
- propagator,
- span limits,
- attribute limits,
- batch processor limits,
- redaction processor if applicable.

Set limits:

```text
max attributes per span
max events per span
max links per span
max attribute length
exporter queue size
batch size
export timeout
```

Without limits, incidents can create telemetry memory pressure.

---

## 36. Observability as Product

Observability has users:

- on-call engineers,
- service owners,
- SRE/platform,
- security,
- compliance,
- product/support,
- leadership.

Each data item should serve a user need.

Examples:

- SLO metrics serve on-call and leadership.
- traces serve engineers debugging critical path.
- audit logs serve compliance/security.
- debug logs serve short-term troubleshooting.
- profiles serve performance engineers.

Different users require different retention/access/cost.

---

## 37. Balancing Detail and Cost

A useful strategy:

```text
Metrics: broad, cheap, complete, low cardinality.
Logs: discrete events, richer context, sampled/leveled.
Traces: causal path, sampled, errors/slow requests prioritized.
Profiles: on-demand or continuous for runtime cost attribution.
```

Do not force one telemetry type to do all jobs.

Bad:

- using logs for metrics,
- using metrics for per-user debugging,
- using traces for per-row analytics,
- using profiles as only alert source.

---

## 38. Checklist: New Metric Review

```text
[ ] What question does this metric answer?
[ ] Who owns it?
[ ] Is it counter/gauge/histogram?
[ ] Are labels bounded?
[ ] Estimated active series?
[ ] Any PII/secrets?
[ ] Does it need histogram buckets?
[ ] Is it used in dashboard/alert/SLO?
[ ] What is retention?
[ ] How will it be deprecated?
```

---

## 39. Checklist: New Log Review

```text
[ ] What event does this log represent?
[ ] Is it boundary-level or duplicate internal log?
[ ] What level?
[ ] Any PII/secrets/payload?
[ ] Field names follow schema?
[ ] Is error_class included?
[ ] Is trace_id/request_id included?
[ ] Could it log in a loop?
[ ] Is sampling needed?
[ ] Is message actionable?
```

---

## 40. Checklist: New Span Review

```text
[ ] Is this operation meaningful in request critical path?
[ ] Is span count bounded?
[ ] Are attributes bounded?
[ ] Any PII/secrets?
[ ] Are errors/status recorded correctly?
[ ] Is it redundant with auto-instrumentation?
[ ] Does it help diagnose latency/dependency?
[ ] Is sampling policy appropriate?
```

---

## 41. Exercises

### Exercise 1 — Cardinality Calculation

Given metric:

```text
http_request_duration_seconds_bucket{route,method,status_code,pod,user_id}
```

Assume:

```text
routes=80
methods=5
status_code=20
pods=50
user_id=1,000,000
buckets=15 + sum/count
```

Calculate potential series and propose safer labels.

### Exercise 2 — Redaction Test

Implement `slog` redaction for:

```text
authorization
cookie
password
token
secret
```

Write a test that proves raw token is absent.

### Exercise 3 — Trace Cost Review

A batch job creates one span per row for 500k rows.

Design better tracing/metrics.

### Exercise 4 — Log Budget

Given service emits:

```text
200 RPS
1 access log 1KB/request
3 debug logs 2KB/request
retention 30 days
```

Estimate volume and propose reduction.

### Exercise 5 — Governance PR Review

Review a fake PR that adds:

```text
metric label user_id
log full request DTO
span attr email
```

Write review comments and safer alternatives.

---

## 42. What Good Looks Like

Anda memahami observability cost/cardinality/governance secara production-grade jika mampu:

1. menghitung cardinality risk,
2. mencegah raw path/user ID metric labels,
3. merancang label budget,
4. mengontrol log volume,
5. mengontrol trace span volume,
6. menerapkan redaction,
7. membedakan PII/secrets/internal data,
8. membuat retention/indexing strategy,
9. menambahkan telemetry review ke PR,
10. memperlakukan observability sebagai produk dengan owner dan lifecycle.

---

## 43. Summary

Observability harus:

```text
berguna
terjangkau
aman
```

Tanpa governance:

- metrics bisa meledakkan TSDB,
- logs bisa membocorkan PII,
- traces bisa membanjiri backend,
- profiles bisa tersebar tanpa kontrol,
- dashboards menjadi lambat,
- alerts menjadi noisy,
- biaya naik tanpa reliability naik.

Prinsip utama:

```text
Low-cardinality metrics for broad truth.
Structured logs for important events.
Sampled traces for causality.
Profiles for cost attribution.
Governed retention and access for safety.
```

Top-tier engineer tidak hanya menambah telemetry.

Top-tier engineer merancang telemetry agar bisa bertahan di production scale.

---

## 44. Status Seri

Bagian ini adalah:

```text
learn-go-logging-observability-profiling-troubleshooting-part-028.md
```

Status:

```text
Part 028 dari 032
Seri belum selesai
```

Bagian berikutnya:

```text
learn-go-logging-observability-profiling-troubleshooting-part-029.md
```

Topik berikutnya:

```text
Building an Internal Observability Toolkit in Go
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-027.md">⬅️ Part 027 — Dashboard Design for Go Services</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-029.md">Part 029 — Building an Internal Observability Toolkit in Go ➡️</a>
</div>

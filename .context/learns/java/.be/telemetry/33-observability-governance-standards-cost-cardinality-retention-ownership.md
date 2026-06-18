# Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `33-observability-governance-standards-cost-cardinality-retention-ownership.md`  
> Scope: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, JFR, profiling, troubleshooting, production operations  
> Level: Advanced / Staff+ Engineering / Top 1% Runtime Engineering

---

## 0. Tujuan Part Ini

Sampai bagian sebelumnya, kita sudah membahas banyak teknik:

- logging semantics,
- SLF4J,
- Logback,
- Log4j2,
- structured logging,
- context propagation,
- OpenTelemetry,
- metrics,
- tracing,
- JFR,
- async-profiler,
- JVM tools,
- memory/thread/GC/dependency troubleshooting,
- Kubernetes observability,
- incident playbooks.

Namun ada satu masalah yang hampir selalu muncul ketika organisasi mulai serius memakai observability:

> Observability yang tidak dikelola akan berubah menjadi biaya tinggi, noise tinggi, cardinality tinggi, retention kacau, dashboard mati, alert fatigue, dan telemetry yang sulit dipercaya.

Part ini membahas **observability governance**.

Governance bukan birokrasi dokumentasi. Governance adalah mekanisme agar telemetry tetap:

1. berguna,
2. konsisten,
3. murah secara relatif,
4. aman,
5. bisa dipakai saat incident,
6. bisa di-maintain oleh tim,
7. tidak menjadi liability compliance,
8. tidak menjadi performance problem.

Dalam sistem Java production, governance menjadi sangat penting karena telemetry bisa datang dari banyak sumber:

- SLF4J/Logback/Log4j2 logs,
- OpenTelemetry Java Agent,
- manual OpenTelemetry instrumentation,
- Micrometer metrics,
- JVM metrics,
- JFR files,
- async-profiler artifacts,
- application audit logs,
- security events,
- database telemetry,
- Kubernetes telemetry,
- collector enrichment,
- vendor-specific dashboards.

Tanpa aturan, setiap service akan membuat field sendiri, level sendiri, metric label sendiri, span name sendiri, sampling sendiri, retention sendiri, dan alert sendiri. Pada skala kecil masih bisa ditoleransi. Pada skala enterprise, ini menjadi masalah operasi.

---

## 1. Core Mental Model: Observability Is a Shared Runtime Contract

Observability bukan properti individual service saja. Observability adalah **kontrak lintas service**.

Sebuah log event dari service A, span dari service B, metric dari service C, dan Kubernetes event dari pod D hanya akan berguna jika semuanya bisa dikorelasikan.

Artinya harus ada kesepakatan tentang:

- nama service,
- nama environment,
- region/cluster/namespace,
- trace identity,
- correlation identity,
- request identity,
- tenant identity,
- severity,
- event category,
- metric naming,
- metric label policy,
- span naming,
- sampling,
- retention,
- ownership,
- alert severity,
- incident workflow.

Tanpa kontrak ini, telemetry menjadi data lake yang noisy.

### 1.1 Observability Governance Bukan Membatasi Engineer

Governance yang buruk berkata:

> Jangan buat log. Jangan buat metric. Jangan buat span.

Governance yang baik berkata:

> Buat telemetry yang bisa menjawab pertanyaan production dengan cost dan risiko yang terkendali.

Tujuannya bukan mengurangi visibility secara buta, tetapi meningkatkan **evidence quality per byte**.

### 1.2 Observability sebagai Data Product

Telemetry adalah data product internal.

Seperti data product lain, ia butuh:

- schema,
- owner,
- lifecycle,
- quality checks,
- consumers,
- retention,
- security classification,
- cost model,
- deprecation policy.

Jika tidak, telemetry akan membusuk.

### 1.3 The Top 1% View

Engineer biasa bertanya:

> “Log apa yang harus saya tambahkan?”

Engineer senior bertanya:

> “Saat incident terjadi, bukti apa yang diperlukan untuk membedakan 5 kemungkinan root cause paling mungkin?”

Engineer top-tier bertanya:

> “Bagaimana kita membuat seluruh organisasi menghasilkan telemetry yang konsisten, aman, hemat, dan bisa menjawab diagnosis lintas service tanpa bergantung pada ingatan individu?”

---

## 2. Observability Governance Dimensions

Observability governance punya beberapa dimensi utama:

1. **Schema governance** — field apa yang wajib, opsional, dilarang.
2. **Naming governance** — nama service, metric, span, event.
3. **Cardinality governance** — label/attribute mana yang aman dan mana yang merusak backend.
4. **Cost governance** — volume, ingest, storage, query, retention, sampling.
5. **Security governance** — PII, secrets, audit boundary, access control.
6. **Retention governance** — berapa lama telemetry disimpan berdasarkan nilai dan risiko.
7. **Ownership governance** — siapa pemilik dashboard, alert, runbook, schema.
8. **Quality governance** — telemetry diuji, direview, dan dipantau kualitasnya.
9. **Incident governance** — alert harus punya owner, severity, runbook, dan expected action.
10. **Lifecycle governance** — telemetry bisa dibuat, diubah, deprecated, dan dihapus secara aman.

---

## 3. Standardizing Service Identity

Sebelum membahas logs/metrics/traces, organisasi harus menstandarkan identitas service.

Tanpa service identity yang stabil, semua dashboard dan query akan rapuh.

### 3.1 Minimum Resource Identity

Setiap telemetry event harus bisa menjawab:

- service apa yang menghasilkan signal?
- versi berapa?
- environment apa?
- deployment mana?
- cluster/namespace/pod mana?
- runtime Java versi berapa?

Minimum fields:

```text
service.name
service.namespace
service.version
deployment.environment.name
cloud.provider
cloud.region
k8s.cluster.name
k8s.namespace.name
k8s.pod.name
k8s.container.name
host.name
process.runtime.name
process.runtime.version
```

Tidak semua fields harus dibuat manual oleh aplikasi. Banyak fields bisa diperkaya oleh OpenTelemetry Collector atau Kubernetes metadata processor.

### 3.2 Service Name Rules

Service name harus:

- stabil,
- lowercase,
- tidak mengandung versi,
- tidak mengandung pod name,
- tidak mengandung deployment timestamp,
- tidak mengandung environment,
- tidak berubah karena refactoring internal package.

Contoh buruk:

```text
aceas-case-service-v2-uat
case-service-blue-20260618
CaseServiceImpl
aceas-case-service-pod-7d9d6f
```

Contoh baik:

```text
aceas-case-service
aceas-application-service
aceas-notification-service
```

Environment harus berada di attribute environment, bukan di service name.

### 3.3 Why This Matters

Jika environment dimasukkan ke `service.name`, maka service map akan menganggap UAT dan PROD sebagai service berbeda.

Jika versi dimasukkan ke `service.name`, maka deployment baru akan memecah time series.

Jika pod name dimasukkan ke `service.name`, cardinality akan meledak.

---

## 4. Logging Standard Governance

Logging standard harus menjawab beberapa hal:

1. event apa yang wajib dicatat?
2. event apa yang tidak boleh dicatat?
3. field apa yang wajib?
4. field apa yang dilarang?
5. level apa yang benar?
6. kapan stack trace dicetak?
7. bagaimana log dikorelasikan dengan trace?
8. bagaimana log dipakai untuk audit/security?

### 4.1 Minimum Structured Log Schema

Minimal JSON log production-grade:

```json
{
  "@timestamp": "2026-06-18T10:15:30.123Z",
  "severity": "INFO",
  "logger.name": "com.example.case.CaseService",
  "thread.name": "http-nio-8080-exec-12",
  "service.name": "case-service",
  "service.version": "2026.06.18.1",
  "deployment.environment.name": "prod",
  "trace.id": "...",
  "span.id": "...",
  "correlation.id": "...",
  "request.id": "...",
  "event.name": "case.submission.accepted",
  "event.category": "business",
  "event.action": "submit",
  "event.outcome": "success",
  "message": "Case submission accepted",
  "case.id": "CASE-2026-00001234",
  "actor.type": "user",
  "module": "case-management"
}
```

### 4.2 Required Log Fields by Category

#### Diagnostic Application Log

Required:

```text
@timestamp
severity
service.name
service.version
deployment.environment.name
logger.name
thread.name
trace.id
span.id
correlation.id
event.name
event.category
event.outcome
message
```

#### Dependency Log

Additional required:

```text
dependency.name
dependency.type
operation.name
duration.ms
attempt
retryable
error.type
```

#### State Transition Log

Additional required:

```text
entity.type
entity.id
state.previous
state.next
transition.name
transition.reason
actor.type
actor.id_hash_or_internal_id
```

#### Audit Log

Additional required:

```text
audit.event_id
audit.subject_type
audit.subject_id
audit.action
audit.outcome
audit.actor_type
audit.actor_id
audit.occurred_at
audit.source_ip_hash_or_masked
audit.integrity_hash_optional
```

#### Security Log

Additional required:

```text
security.event_type
security.decision
security.reason_code
actor.type
actor.id_hash_or_internal_id
auth.method
client.ip_masked
```

### 4.3 Log Level Governance

Recommended standard:

| Level | Meaning | Should alert? | Example |
|---|---|---:|---|
| TRACE | Very detailed local diagnostic flow | No | serializer field-level decision |
| DEBUG | Developer diagnostic, disabled in prod by default | No | rule selected, cache path |
| INFO | Important normal business/technical lifecycle event | No | app started, job completed |
| WARN | Unexpected but handled degradation | Usually no, maybe aggregated | retry exhausted but fallback worked |
| ERROR | Failed operation requiring attention or user/system impact | Maybe yes | request failed due to dependency outage |

Critical governance rule:

> ERROR logs must represent actionable failure, not every rejected user input.

Validation failure from user input should usually be INFO or DEBUG depending on audit/security need, unless it indicates attack pattern or systemic issue.

### 4.4 Stack Trace Governance

Rules:

1. Stack trace should be logged once per failure boundary.
2. Do not log stack trace at every layer.
3. Expected business validation failure should not produce stack trace.
4. Dependency failure should include stack trace at owning boundary, not both client wrapper and global handler.
5. Stack trace must be redacted if exception message contains sensitive payload.

Bad pattern:

```java
try {
    service.submit(request);
} catch (Exception e) {
    log.error("submit failed", e);
    throw e;
}
```

If upstream global handler also logs the exception, this duplicates stack traces.

Better pattern:

```java
try {
    service.submit(request);
} catch (DependencyTimeoutException e) {
    throw new SubmitCaseFailedException("CASE_SUBMIT_DEPENDENCY_TIMEOUT", e);
}
```

Then log once at the boundary where the operation failure is reported.

### 4.5 Log Event Naming

Event names should be:

- stable,
- lowercase,
- dot-separated,
- not include IDs,
- not include status code unless bounded,
- not include free-form text.

Good:

```text
case.submission.received
case.submission.accepted
case.submission.rejected
case.state.transitioned
notification.email.send_failed
external.onemap.lookup_failed
```

Bad:

```text
case.12345.failed
submission failed for user fajar
error_500_case_submit_prod
```

---

## 5. Metrics Governance

Metrics governance is stricter than log governance because metric labels create time series.

A single metric with one high-cardinality label can create millions of time series.

### 5.1 Metric Naming Rules

Metric names should be:

- stable,
- unit-aware,
- lowercase,
- dot-separated or backend-conventional,
- not contain dynamic data,
- not contain service name if resource attributes already identify service.

Good:

```text
http.server.request.duration
case.submission.count
db.client.connection.pool.usage
workflow.transition.duration
batch.job.execution.duration
```

Bad:

```text
case_submit_for_user_123
prod_case_service_http_duration
submit_latency_ms_for_CASE_2026_0001
```

### 5.2 Unit Governance

Every metric must declare unit.

Examples:

| Metric | Unit |
|---|---|
| request duration | `s` or `ms`, consistently |
| payload size | `By` |
| queue depth | `{message}` |
| retry count | `{attempt}` |
| active connection | `{connection}` |
| JVM memory | `By` |
| CPU utilization | `1` ratio or `%`, consistently |

Do not mix milliseconds and seconds under one metric name.

### 5.3 Instrument Type Governance

| Signal | Instrument |
|---|---|
| Number of requests | Counter |
| Number of failures | Counter |
| Duration distribution | Histogram |
| Current active requests | UpDownCounter/Gauge |
| Queue depth | Gauge |
| Current pool usage | Gauge |
| In-flight jobs | UpDownCounter/Gauge |
| Payload size distribution | Histogram |

Do not use Gauge for cumulative event count. Do not use Counter for current active value.

### 5.4 Label Governance

Labels must be bounded.

Safe labels:

```text
http.request.method
http.response.status_code
error.type
operation.name
dependency.name
queue.name
job.name
workflow.name
transition.name
outcome
environment
region
```

Dangerous labels:

```text
user.id
case.id
request.id
trace.id
span.id
session.id
email
ip.address
full.url
raw.query
exception.message
sql.statement
file.path
pod.name   # sometimes acceptable for infra metrics, dangerous for app-level aggregation
```

### 5.5 Cardinality Budget

Each team should have an explicit cardinality budget.

Example budget:

| Signal | Budget |
|---|---:|
| Service-level metrics per service | ≤ 200 active series baseline |
| Business metrics per service | ≤ 100 active series baseline |
| HTTP route label values | ≤ 100 |
| Error type values | ≤ 50 |
| Dependency name values | ≤ 30 |
| Queue name values | ≤ 50 |
| Custom metric labels | ≤ 5 labels per metric unless reviewed |

This is not a universal number. It is a starting policy. Each platform has different storage and query limits.

### 5.6 Metric Label Review Questions

Before adding a label, ask:

1. Is the value bounded?
2. Can the set of values grow with users, requests, tenants, cases, files, sessions, or payloads?
3. Is it needed for alerting or SLO?
4. Is it needed for dashboard grouping?
5. Could it instead be a log field or span attribute?
6. What is the maximum number of values in PROD?
7. What happens after 1 year?

Rule of thumb:

> High-cardinality values belong in logs/traces, not metrics, unless explicitly reviewed.

### 5.7 Metrics Ownership

Every production metric should have:

```yaml
metric: case.submission.count
owner: team-case-platform
purpose: Business throughput and submission health
used_by:
  - dashboard: Case Submission Overview
  - alert: Case submission stopped
retention: 13 months aggregated, 30 days raw
labels:
  - outcome
  - channel
  - agency
status: active
```

If no dashboard, alert, SLO, or investigation uses a metric, it should be reviewed for deletion.

---

## 6. Trace Governance

Traces are powerful but expensive.

Without governance, traces become:

- too many,
- too shallow,
- too noisy,
- poorly named,
- missing business attributes,
- full of high-cardinality attributes,
- impossible to search,
- sampled away during incidents.

### 6.1 Span Naming Standard

Span names must be low-cardinality.

Good:

```text
GET /cases/{caseId}
POST /applications/{applicationId}/submit
CaseSubmissionService.submit
RuleEngine.evaluate
ExternalAddressClient.lookup
```

Bad:

```text
GET /cases/CASE-2026-00001234
submit case for user 12345
lookup postal 018989
SQL SELECT * FROM CASE WHERE ID = 123
```

### 6.2 Required Span Attributes

For manual business spans:

```text
component
operation.name
event.domain
entity.type
entity.id_hash_or_safe_id_optional
workflow.name
transition.name_optional
outcome
error.type_optional
```

For dependency spans:

```text
dependency.name
dependency.type
operation.name
retry.attempt
timeout.ms
error.type
```

### 6.3 Span Attribute Cardinality

Span attributes tolerate higher cardinality better than metric labels, but not unlimited.

Trace backend indexing can still become expensive if every span has indexed high-cardinality fields.

Governance rule:

- IDs may exist as span attributes if needed for investigation.
- IDs should not be used as span names.
- Sensitive IDs should be hashed/masked.
- Indexing policy must be explicit.

### 6.4 Sampling Governance

Sampling is a governance decision, not a random config.

Types:

1. Head sampling — decision at trace start.
2. Tail sampling — decision after seeing trace content.
3. Parent-based sampling — child follows parent decision.
4. Error-biased sampling — keep errors at higher rate.
5. Latency-biased sampling — keep slow traces.
6. Endpoint-specific sampling — high-value endpoints sampled more.
7. Tenant/agency-specific sampling — only if policy permits.

Example policy:

```yaml
sampling:
  default_success_trace_rate: 0.05
  error_trace_rate: 1.0
  slow_trace_rate: 1.0
  slow_threshold_ms: 2000
  payment_or_submission_flows: 0.25
  health_check: 0.001
```

### 6.5 Tail Sampling Trade-Off

Tail sampling is powerful because it can keep traces based on error or latency after observing the trace.

But it costs:

- collector memory,
- buffering delay,
- more complex topology,
- requirement that spans of one trace reach same collector decision point,
- more operational complexity.

Use tail sampling when:

- error traces must be retained,
- slow traces matter,
- head sampling misses important rare failures,
- telemetry volume is too high for always-on retention.

Avoid tail sampling if collector capacity and routing are not ready.

### 6.6 Trace Ownership

Each critical journey should have a trace design owner.

Example:

```yaml
journey: case-submission
owner: team-case-platform
entry_span: POST /cases/{caseId}/submit
critical_spans:
  - CaseSubmissionService.validate
  - RuleEngine.evaluate
  - CaseRepository.persist
  - NotificationClient.send
required_attributes:
  - correlation.id
  - case.type
  - submission.channel
  - outcome
  - error.type
sampling_policy:
  success: 0.25
  error: 1.0
  slow: 1.0
```

---

## 7. Log Storage and Retention Governance

Telemetry retention must balance:

- operational value,
- compliance value,
- cost,
- security risk,
- query performance,
- forensic needs.

### 7.1 Not All Logs Have Same Retention

Suggested retention model:

| Data type | Raw retention | Aggregated/indexed retention | Notes |
|---|---:|---:|---|
| Application diagnostic logs | 7–30 days | optional 90 days | high volume |
| Error logs | 30–90 days | 6–13 months aggregate | useful for trend |
| Audit logs | 1–7 years depending policy | long-term archive | immutable/tamper-evident |
| Security logs | 90 days–1 year hot/warm | longer archive | depends on regulation |
| Access logs | 7–90 days | aggregate longer | privacy risk |
| Debug logs | hours–days | usually none | should be temporary |
| Trace data | 7–30 days | aggregate service map longer | depends sampling |
| Metrics raw | 7–30 days | downsampled 13 months+ | SLO trend |
| JFR/profiler artifacts | incident-scoped | archive only when needed | may contain sensitive data |

### 7.2 Hot, Warm, Cold Retention

A production observability system often has tiers:

1. Hot — fast query, expensive storage, short retention.
2. Warm — slower query, lower cost, medium retention.
3. Cold/archive — cheapest, forensic/compliance retrieval, long retention.

Example:

```text
Application logs:
- hot: 14 days
- warm: 45 days
- cold: not retained unless incident-tagged

Audit logs:
- hot: 90 days
- warm: 1 year
- cold: 7 years

Metrics:
- raw: 15 days
- 5-min aggregate: 90 days
- 1-hour aggregate: 13 months
```

### 7.3 Retention Anti-Patterns

Bad:

- keep everything forever,
- delete everything after 7 days including audit/security evidence,
- retain debug logs with PII,
- retain heap dumps without classification,
- no retention difference between diagnostic logs and audit logs,
- raw high-cardinality metrics retained too long.

### 7.4 Incident Preservation

During major incident, relevant telemetry may need to be preserved beyond normal retention.

Policy:

```yaml
incident_artifact_preservation:
  trigger: SEV1 or SEV2
  artifacts:
    - logs around incident window
    - traces around incident window
    - dashboards snapshots
    - JFR file
    - thread dumps
    - heap histogram
    - selected heap dump if approved
  retention: 1 year or per compliance policy
  access: restricted
```

---

## 8. Cost Governance

Observability cost usually comes from:

1. ingest volume,
2. indexing,
3. retention,
4. high cardinality,
5. query load,
6. dashboard refresh rate,
7. trace span volume,
8. log verbosity,
9. duplicate telemetry,
10. vendor-specific pricing model.

### 8.1 Telemetry Cost Equation

Simplified:

```text
cost ≈ events_per_second
     × average_event_size
     × indexed_fields_multiplier
     × retention_days
     × replication_factor
     × query_cost
```

For metrics:

```text
cost ≈ number_of_time_series
     × scrape_frequency
     × retention_days
     × query_frequency
```

For traces:

```text
cost ≈ traces_per_second
     × spans_per_trace
     × attributes_per_span
     × sampling_rate
     × retention_days
```

### 8.2 Cost Controls

Controls:

- reduce DEBUG in production,
- use sampling for repetitive success logs,
- rate-limit log storms,
- remove duplicate logs,
- use structured logs but limit field count,
- avoid indexing every field,
- enforce metric label policy,
- downsample old metrics,
- sample successful traces,
- keep error/slow traces,
- drop health-check spans/logs aggressively,
- aggregate high-volume business events,
- route audit/security logs separately.

### 8.3 Cost Dashboard

Each team should see:

- log GB/day by service,
- log event count/day by service,
- top loggers by volume,
- top event names by volume,
- error log rate,
- duplicate log candidates,
- metric time series count by service,
- highest cardinality metric labels,
- trace spans/day by service,
- average spans per trace,
- collector dropped data,
- query volume by dashboard.

### 8.4 Cost Review Cadence

Recommended:

- weekly: top telemetry volume changes,
- monthly: cardinality review,
- quarterly: retention and dashboard usage review,
- per release: new metric/span/log schema review for major features.

---

## 9. Cardinality Governance Deep Dive

Cardinality is the number of distinct values a field can take.

High cardinality is not always bad, but it is dangerous in the wrong place.

### 9.1 Cardinality by Signal

| Signal | High-cardinality tolerance | Notes |
|---|---:|---|
| Logs | Medium/high | Query index cost depends backend |
| Traces | Medium | Span attributes can be high, indexing must be controlled |
| Metrics | Low | Labels create time series explosion |
| Profiles | Different model | Not label-driven in same way |
| JFR | Artifact-based | Sensitive data risk, not cardinality cost mainly |

### 9.2 Dynamic Values Classification

| Value | Metrics label? | Span attr? | Log field? |
|---|---:|---:|---:|
| HTTP method | Yes | Yes | Yes |
| HTTP route template | Yes | Yes | Yes |
| HTTP full URL | No | Usually no/raw avoid | Maybe redacted |
| status code | Yes | Yes | Yes |
| exception type | Yes with cap | Yes | Yes |
| exception message | No | Usually no | Maybe sanitized |
| user ID | No | Maybe hashed | Maybe hashed |
| tenant ID | Maybe if bounded | Yes | Yes |
| case ID | No | Maybe | Yes if allowed |
| trace ID | No | Yes/inherent | Yes |
| request ID | No | Maybe | Yes |
| SQL statement | No | Maybe sanitized/fingerprint | Maybe fingerprint |
| queue name | Yes | Yes | Yes |
| pod name | For infra only | Resource attr | Resource/log attr |

### 9.3 Cardinality Review Example

Bad metric:

```text
case.submission.duration{case_id="CASE-2026-000123", user_id="U123", status="success"}
```

Why bad:

- `case_id` grows with cases.
- `user_id` grows with users.
- Every submission creates new time series.

Better metric:

```text
case.submission.duration{case_type="new", channel="web", outcome="success"}
```

Then put `case.id` and `user.id_hash` in logs/traces, not metric labels.

### 9.4 Cardinality Kill Switch

For safety, platform should support:

- dropping specific labels,
- dropping high-volume metrics,
- limiting metric cardinality,
- reducing trace sampling,
- suppressing noisy loggers,
- dynamic log level reset,
- collector-side filters.

Example OTel Collector policy idea:

```yaml
processors:
  attributes/drop_high_cardinality:
    actions:
      - key: user.id
        action: delete
      - key: session.id
        action: delete
      - key: request.id
        action: delete
```

Use carefully. Dropping too aggressively can destroy diagnostic value.

---

## 10. Dashboard Governance

Dashboards decay.

A dashboard without owner becomes misleading over time.

### 10.1 Dashboard Types

1. **Service overview dashboard** — health of one service.
2. **Journey dashboard** — end-to-end user/business flow.
3. **Dependency dashboard** — DB/API/queue/cache health.
4. **JVM dashboard** — heap, GC, threads, CPU, direct memory.
5. **Kubernetes dashboard** — pod, container, node, throttling, OOMKilled.
6. **Incident dashboard** — high-signal triage view.
7. **SLO dashboard** — SLI/error budget.
8. **Cost dashboard** — telemetry volume and cardinality.

### 10.2 Dashboard Ownership Metadata

Every dashboard should have:

```yaml
dashboard: Case Service Overview
owner: team-case-platform
purpose: Triage health of case-service
primary_users:
  - on-call engineer
  - tech lead
  - SRE/platform
last_reviewed: 2026-06-01
review_cadence: quarterly
dependencies:
  - HikariCP metrics
  - JVM metrics
  - HTTP server metrics
  - OTel traces
alerts_linked:
  - case-service-error-rate-high
  - case-service-latency-slo-burn
runbook: runbooks/case-service.md
status: active
```

### 10.3 Dashboard Quality Rules

A good dashboard:

- answers specific questions,
- starts from user/service health,
- separates symptom from cause,
- uses consistent time windows,
- avoids too many panels,
- shows p50/p95/p99 where relevant,
- shows rate and error ratio, not only raw counts,
- includes saturation signals,
- links to logs/traces/runbook,
- includes deployment/change markers,
- has owner and review date.

Bad dashboard:

- 70 panels with no story,
- random JVM internals without service-level health,
- averages only,
- no labels explanation,
- unknown owner,
- no runbook,
- no environment selector,
- broken panels ignored for months.

---

## 11. Alert Governance

Alerts are promises to interrupt humans.

Bad alerts destroy trust.

### 11.1 Alert Rule

A page-worthy alert must satisfy:

1. user impact or imminent user impact,
2. actionable by receiving team,
3. has runbook,
4. has owner,
5. has severity,
6. has enough context,
7. avoids duplicate pages for same cause.

### 11.2 Alert Types

| Type | Page? | Example |
|---|---:|---|
| SLO burn | Yes | 5xx/latency consuming error budget fast |
| Hard outage | Yes | no successful submission for 10 minutes |
| Resource saturation imminent | Maybe yes | DB pool 95% used + request wait rising |
| Informational anomaly | No | deploy happened |
| Dashboard-only trend | No | slow memory growth below threshold |
| Debug telemetry issue | No, unless critical | missing traces in DEV |

### 11.3 Alert Metadata

```yaml
alert: case-service-error-budget-fast-burn
owner: team-case-platform
severity: SEV2
signal: metric
query: ...
condition: error_budget_burn_rate > threshold
impact: Case submission may fail for users
runbook: runbooks/case-service-error-rate.md
dashboards:
  - Case Service Overview
logs_query: event.category=error service.name=case-service
traces_query: service.name=case-service status=error
suppression:
  - during planned maintenance
last_reviewed: 2026-06-01
```

### 11.4 Symptom-Based vs Cause-Based Alerts

Prefer symptom-based alerts for paging.

Good page:

```text
Case submission success rate below SLO
```

Bad page:

```text
JVM heap > 75%
```

Heap > 75% may be normal. It should be dashboard or warning unless correlated with user impact or imminent OOM.

### 11.5 Alert Fatigue Controls

- deduplicate by service/journey,
- route by ownership,
- use burn-rate alerts,
- avoid raw threshold spam,
- group dependency-related alerts,
- suppress known maintenance,
- review noisy alerts monthly,
- delete unactionable alerts.

---

## 12. Runbook Governance

An alert without runbook is incomplete.

A runbook should not be a novel. It should be a fast decision aid.

### 12.1 Runbook Template

```markdown
# Runbook: Case Service Error Rate High

## Alert Meaning
What this alert means and what user impact is expected.

## First 5 Minutes
1. Check service overview dashboard.
2. Check error rate split by endpoint/outcome.
3. Check recent deployments.
4. Check dependency dashboard.
5. Check traces for failing requests.

## Key Dashboards
- Case Service Overview
- DB Dependency Dashboard
- Kubernetes Pod Health

## Key Queries
Logs:
...
Traces:
...
Metrics:
...

## Common Causes
- DB pool exhaustion
- downstream timeout
- validation rule deployment bug
- queue backlog

## Mitigation Options
- rollback deployment
- scale replicas
- disable non-critical integration
- increase timeout only if safe
- drain/restart stuck consumers

## Escalation
- Team owner
- DB team
- Platform team

## Post-Incident Evidence
- timeline
- metrics snapshot
- traces
- representative logs
- JFR/thread dumps if applicable
```

### 12.2 Runbook Quality Review

Runbook should be tested during:

- game day,
- incident simulation,
- post-incident review,
- onboarding.

If new team member cannot follow it, it is not good enough.

---

## 13. Ownership Model

Observability ownership must be explicit.

### 13.1 Ownership Layers

| Layer | Owner |
|---|---|
| Application logs | Service team |
| Business metrics | Product/service team |
| JVM/Kubernetes baseline metrics | Platform/SRE + service team |
| Collector pipeline | Platform/SRE |
| Semantic conventions | Architecture/platform group |
| Audit logs | App team + security/compliance |
| Security logs | Security + app team |
| Alert routing | Service team + SRE |
| Runbooks | Service team |
| Dashboards | Service team or journey owner |
| Retention policy | Platform + security/compliance |
| Cost budget | Engineering management + platform |

### 13.2 RACI Example

| Artifact | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Service log schema | Service team | Service TL | Platform/Security | QA/Ops |
| OTel collector config | Platform | Platform TL | Service teams | Ops |
| Audit log policy | Service + Security | Compliance owner | Architecture | PM/QA |
| SLO alerts | Service team | Service TL | SRE/PM | Support |
| Retention policy | Platform/Security | Engineering leadership | Legal/Compliance | Teams |

---

## 14. Observability Review in Pull Requests

Telemetry must be reviewed like code.

### 14.1 PR Checklist for Logs

- Does the log represent a meaningful event?
- Is level correct?
- Is event name stable?
- Are required fields present?
- Are forbidden fields absent?
- Is stack trace logged only once?
- Is PII/secret redacted?
- Is correlation context included?
- Could this create log storm?
- Does it duplicate existing log?

### 14.2 PR Checklist for Metrics

- Is metric name stable?
- Is unit defined?
- Is instrument type correct?
- Are labels bounded?
- Is cardinality estimated?
- Is metric used by dashboard/alert/SLO?
- Is retention cost acceptable?
- Is there a test if critical?

### 14.3 PR Checklist for Traces

- Is span boundary meaningful?
- Is span name low-cardinality?
- Are attributes useful and safe?
- Are errors recorded correctly?
- Is context propagated across async boundary?
- Is sampling policy considered?
- Does it duplicate auto-instrumentation?

### 14.4 PR Checklist for Alerts

- Is alert user-impacting or imminent impact?
- Is it actionable?
- Does it have owner?
- Does it have runbook?
- Is severity correct?
- Will it duplicate existing alert?
- Has threshold been validated against historical data?

---

## 15. Telemetry Testing

Observability should be tested.

### 15.1 Unit-Level Testing

Test that important event is emitted.

Example conceptual test:

```java
@Test
void logsStateTransitionEvent() {
    // arrange test appender
    // execute transition
    // assert event.name == "case.state.transitioned"
    // assert previous/next state fields exist
    // assert no raw NRIC/token/password field exists
}
```

### 15.2 Integration Testing

Test:

- trace IDs appear in logs,
- MDC cleaned after request,
- error span status is set,
- metrics emitted with bounded labels,
- audit log emitted for required action,
- collector receives telemetry.

### 15.3 Load Testing Telemetry

During load test, observe:

- log throughput,
- logging queue saturation,
- collector CPU/memory,
- dropped spans/logs/metrics,
- metric series count,
- trace sampling behavior,
- dashboard query latency,
- cost projection.

### 15.4 Failure Injection

Inject:

- DB timeout,
- external API timeout,
- queue backlog,
- retry storm,
- validation error burst,
- authentication failure burst,
- log appender slowdown,
- collector unavailable.

Then verify telemetry still supports diagnosis.

---

## 16. Schema Registry for Observability

For large systems, maintain an observability schema registry.

### 16.1 Registry Contents

```yaml
log_events:
  - name: case.submission.accepted
    owner: team-case-platform
    category: business
    required_fields:
      - case.type
      - submission.channel
      - outcome
    forbidden_fields:
      - user.email
      - token
      - raw_payload
    retention_class: diagnostic

metrics:
  - name: case.submission.count
    owner: team-case-platform
    type: counter
    unit: "{submission}"
    labels:
      - outcome
      - channel
      - case_type
    max_cardinality_estimate: 30

spans:
  - name: CaseSubmissionService.submit
    owner: team-case-platform
    kind: INTERNAL
    required_attributes:
      - case.type
      - submission.channel
      - outcome
```

### 16.2 Why Registry Matters

It enables:

- searchability,
- review,
- consistency,
- deprecation,
- cost control,
- onboarding,
- automated validation.

---

## 17. Deprecation and Cleanup

Telemetry must have lifecycle.

### 17.1 When to Deprecate Telemetry

Deprecate when:

- metric no longer used,
- dashboard no longer viewed,
- log event duplicates another event,
- field name replaced,
- label cardinality too high,
- alert noisy/unactionable,
- span duplicates auto instrumentation,
- retention no longer justified.

### 17.2 Safe Deprecation Process

1. Mark as deprecated in registry.
2. Notify owners/consumers.
3. Keep compatibility period.
4. Update dashboards/alerts.
5. Stop emitting.
6. Remove from collector/backend indexing.
7. Remove code.

### 17.3 Compatibility for Metrics

Metric rename is breaking.

Prefer:

- emit old + new during transition,
- update dashboards,
- update alerts,
- remove old after agreed period.

---

## 18. Security and Access Governance

Telemetry often contains sensitive information even when engineers try to avoid it.

### 18.1 Access Control by Data Class

| Data | Access |
|---|---|
| Standard app logs | Engineering/support limited |
| Debug logs | Restricted and temporary |
| Audit logs | Restricted; compliance-controlled |
| Security logs | Security + selected engineering |
| Heap dumps | Highly restricted |
| JFR/profiler artifacts | Restricted |
| Trace data | Engineering, but check attributes |
| Metrics | Broadest access usually safe |

### 18.2 Sensitive Artifact Handling

Heap dumps and JFR files may contain:

- object values,
- request payloads,
- credentials,
- tokens,
- customer data,
- SQL parameters,
- thread names with IDs,
- stack traces with sensitive method arguments depending tool.

Policy:

- never attach to public ticket,
- store encrypted,
- restrict access,
- delete after incident retention period,
- document access,
- avoid copying to personal laptop unless approved.

### 18.3 Redaction Governance

Redaction should happen as close to source as possible.

Layers:

1. Application code avoids logging sensitive values.
2. Logging utility masks known sensitive fields.
3. Encoder/layout masks patterns.
4. Collector filters/redacts as fallback.
5. Backend access controls protect remaining risk.

Do not rely only on backend redaction.

---

## 19. Governance for Java 8–25

### 19.1 Java 8

Common issues:

- older logging dependencies,
- SLF4J 1.x binding model,
- older GC log format,
- limited built-in container awareness unless updated JVM,
- JFR availability depends distribution/version/licensing history,
- no virtual threads,
- ThreadLocal/MDC propagation mostly manual.

Governance impact:

- dependency standard must specify supported SLF4J/Logback/Log4j2 versions,
- diagnostic command cookbook should include Java 8 variants,
- GC log parser must understand pre-unified logging.

### 19.2 Java 11/17

Common enterprise baseline:

- unified logging available,
- JFR built-in and widely usable,
- better container support,
- strong ecosystem compatibility.

Governance impact:

- standardize JFR readiness,
- use `-Xlog` GC flags,
- standardize OTel agent config.

### 19.3 Java 21+

New concerns:

- virtual threads,
- structured concurrency preview/incubator depending version,
- Scoped Values evolution,
- different thread dump expectations,
- ThreadLocal/MDC cost model changes,
- more concurrency means more trace/context propagation paths.

Governance impact:

- require explicit context propagation strategy,
- avoid assuming platform thread pool identity,
- update thread dump runbooks,
- test logging/MDC with virtual threads.

### 19.4 Java 25

By Java 25, modern platform features reinforce the need to separate:

- request context,
- diagnostic context,
- trace context,
- business identity,
- security identity.

Governance should not depend on accidental ThreadLocal behavior.

---

## 20. Observability Maturity Model

### Level 0 — Accidental Telemetry

Symptoms:

- random logs,
- no structured fields,
- no trace correlation,
- no metric standard,
- dashboards ad hoc,
- alerts noisy,
- no owner.

### Level 1 — Basic Standardization

Capabilities:

- structured logs,
- service identity,
- basic JVM/HTTP metrics,
- basic dashboards,
- simple alerts.

### Level 2 — Correlated Observability

Capabilities:

- logs include trace/correlation IDs,
- metrics/traces/logs linked,
- SLO dashboards,
- runbooks for main alerts,
- basic cardinality policy.

### Level 3 — Governed Observability

Capabilities:

- schema registry,
- PR checklist,
- cost dashboard,
- retention tiers,
- sampling policy,
- ownership metadata,
- telemetry tests.

### Level 4 — Adaptive Observability

Capabilities:

- dynamic sampling,
- incident-triggered artifact capture,
- telemetry quality metrics,
- automatic cardinality detection,
- signal lifecycle management,
- game days validate runbooks.

### Level 5 — Evidence-Driven Engineering Culture

Capabilities:

- observability designed during architecture,
- every critical journey has evidence contract,
- RCA produces observability backlog,
- telemetry is treated as production API,
- cost and quality continuously optimized.

---

## 21. Practical Governance Artifacts

### 21.1 Observability Standard Document

Should include:

```text
1. Service identity rules
2. Logging schema
3. Log level semantics
4. Metric naming and labels
5. Trace/span naming
6. Context propagation standard
7. Sensitive data policy
8. Retention policy
9. Sampling policy
10. Dashboard standard
11. Alert standard
12. Runbook template
13. PR checklist
14. Ownership model
15. Deprecation process
```

### 21.2 Service Observability Manifest

Each service should have a manifest:

```yaml
service: case-service
owner: team-case-platform
runtime:
  java: 21
  framework: spring-boot
logging:
  backend: logback
  format: json
  schema_version: 1.3
metrics:
  standard: opentelemetry/micrometer
  dashboards:
    - case-service-overview
tracing:
  otel_agent: true
  manual_spans:
    - CaseSubmissionService.submit
    - RuleEngine.evaluate
sampling:
  success: 0.10
  error: 1.0
alerts:
  - case-service-error-budget-fast-burn
  - case-service-db-pool-saturation
runbooks:
  - runbooks/case-service.md
retention:
  diagnostic_logs: 30d
  audit_logs: 7y
```

### 21.3 Telemetry Exception Request

When a team wants high-cardinality label or long retention:

```yaml
request: Add tenant_id as metric label
metric: case.submission.count
reason: Need tenant-level SLO reporting for 8 bounded agencies
estimated_cardinality: 8 agencies × 4 outcomes × 3 channels = 96 series
owner: team-case-platform
review_date: 2026-09-01
approval: platform-observability
```

This is acceptable because cardinality is bounded and justified.

---

## 22. Mini Case Study: Observability Cost Explosion

### 22.1 Symptom

Observability bill increases 3x in one month.

No major traffic increase.

### 22.2 Evidence

Cost dashboard shows:

- `application-service` log volume increased from 20 GB/day to 180 GB/day.
- Metric active series increased from 80k to 2.4M.
- Trace spans/day increased 5x.
- Query latency became slow.

### 22.3 Investigation

Recent deployment added:

```java
log.info("Application request payload: {}", rawPayload);
```

Also added metric:

```text
application.validation.failure.count{application_id, user_id, error_message}
```

And span name:

```text
Validate application APP-2026-000123 for user U123
```

### 22.4 Root Cause

Three governance violations:

1. raw payload logging,
2. high-cardinality metric labels,
3. high-cardinality span names.

### 22.5 Fix

Replace log:

```java
log.info("application.validation.failed application_type={} channel={} error_code={} correlation_id={}",
    applicationType,
    channel,
    errorCode,
    correlationId);
```

Replace metric:

```text
application.validation.failure.count{application_type, channel, error_code}
```

Replace span name:

```text
ApplicationValidationService.validate
```

Add attributes:

```text
application.type
channel
error.code
```

Optional safe ID in logs only:

```text
application.id_hash
```

### 22.6 Governance Backlog

- add PR checklist,
- add cardinality CI lint,
- add top loggers dashboard,
- add metric series budget,
- add schema registry,
- add secure logging test.

---

## 23. Mini Case Study: Alert Fatigue

### 23.1 Symptom

On-call receives 40 alerts per night.

Most are ignored.

### 23.2 Evidence

Alert review shows:

- heap usage > 70% alert fires daily,
- CPU > 80% alert fires during batch but no user impact,
- queue depth alert fires during normal scheduled burst,
- duplicate alerts from every pod,
- dependency timeout alert fires but service fallback succeeds.

### 23.3 Root Cause

Alerts are cause-ish raw threshold alerts, not symptom/action-oriented alerts.

### 23.4 Fix

Replace:

```text
Heap > 70%
```

With:

```text
Service latency SLO burn high AND GC pause contribution high
```

Replace:

```text
Queue depth > 1000
```

With:

```text
Oldest message age > 15 minutes AND drain rate insufficient
```

Replace per-pod alerts with service-level aggregation.

### 23.5 Governance Rule

Every page must have:

- user impact or imminent user impact,
- owner,
- runbook,
- action.

---

## 24. Practical Lab: Build an Observability Governance Pack

Create these files:

```text
observability/
  standard.md
  schema-registry.yaml
  service-manifest.yaml
  log-events.yaml
  metrics.yaml
  traces.yaml
  alerts.yaml
  dashboards.yaml
  retention-policy.md
  sampling-policy.md
  secure-logging-policy.md
  pr-checklist.md
  runbook-template.md
```

### 24.1 Exercise 1 — Define Service Manifest

For one Java service, define:

- owner,
- Java version,
- logging backend,
- OTel agent config,
- critical flows,
- dashboards,
- alerts,
- runbooks,
- retention.

### 24.2 Exercise 2 — Review Metrics Cardinality

List all custom metrics.

For each metric:

- name,
- type,
- unit,
- labels,
- estimated cardinality,
- owner,
- used by dashboard/alert/SLO.

Remove or revise metrics with unbounded labels.

### 24.3 Exercise 3 — Review Logs

Find top 20 log events by volume.

For each:

- is it useful?
- is level correct?
- does it include correlation ID?
- does it include forbidden data?
- can it be sampled/rate-limited?
- does it duplicate another event?

### 24.4 Exercise 4 — Alert Audit

For every alert:

- who owns it?
- when was it last fired?
- was it actionable?
- did it detect real user impact?
- does it have runbook?
- should it page or dashboard-only?

### 24.5 Exercise 5 — Retention Review

Classify telemetry:

- diagnostic logs,
- audit logs,
- security logs,
- traces,
- metrics,
- JFR/profiler artifacts,
- heap dumps.

Assign retention and access controls.

---

## 25. Production Readiness Checklist

### 25.1 Service Identity

- [ ] `service.name` stable.
- [ ] `service.version` present.
- [ ] environment not embedded in service name.
- [ ] Kubernetes metadata enriched.
- [ ] deployment markers available.

### 25.2 Logging

- [ ] JSON structured logs enabled in production.
- [ ] trace/correlation IDs included.
- [ ] log level semantics documented.
- [ ] secure logging rules enforced.
- [ ] stack trace duplication avoided.
- [ ] top log volume dashboard exists.
- [ ] noisy loggers reviewed.

### 25.3 Metrics

- [ ] metric names stable.
- [ ] units defined.
- [ ] labels bounded.
- [ ] cardinality reviewed.
- [ ] SLO metrics identified.
- [ ] JVM/container metrics included.
- [ ] unused metrics retired.

### 25.4 Traces

- [ ] span names low-cardinality.
- [ ] critical flows manually instrumented if auto instrumentation insufficient.
- [ ] errors recorded.
- [ ] sampling policy documented.
- [ ] trace-log correlation works.
- [ ] duplicate spans reviewed.

### 25.5 Dashboards

- [ ] dashboard owner defined.
- [ ] dashboard purpose defined.
- [ ] dashboard linked to runbooks.
- [ ] broken panels reviewed.
- [ ] SLO dashboard exists for critical journeys.
- [ ] cost/cardinality dashboard exists.

### 25.6 Alerts

- [ ] page alerts are actionable.
- [ ] alert owner defined.
- [ ] runbook exists.
- [ ] severity defined.
- [ ] noisy alerts reviewed.
- [ ] duplicate alerts suppressed.

### 25.7 Retention and Security

- [ ] retention classes defined.
- [ ] audit/security logs handled separately.
- [ ] heap/JFR/profiler artifact access restricted.
- [ ] PII/secrets redaction tested.
- [ ] incident preservation process defined.

### 25.8 Lifecycle

- [ ] schema registry exists.
- [ ] PR checklist includes observability.
- [ ] telemetry deprecation process exists.
- [ ] ownership metadata maintained.
- [ ] quarterly review scheduled.

---

## 26. Key Takeaways

Observability governance is not optional at scale.

Without governance:

- logs become noise,
- metrics become cardinality bombs,
- traces become expensive and incomplete,
- dashboards rot,
- alerts train engineers to ignore them,
- retention creates either blind spots or liability,
- incidents depend on hero debugging.

With governance:

- telemetry becomes reliable evidence,
- services speak the same runtime language,
- cost is controlled,
- security risk is reduced,
- incident response improves,
- teams can reason across systems.

The core principle:

> Observability is a production API emitted by your system. Treat it with the same discipline as any external API: schema, owner, compatibility, lifecycle, security, and cost.

---

## 27. References

- OpenTelemetry Semantic Conventions — common names and meanings for telemetry attributes across traces, metrics, logs, profiles, and resources.
- OpenTelemetry Attribute Requirement Levels — requirement levels apply to Log, Metric, Resource, and Span attributes.
- OpenTelemetry Sampling — head and tail sampling concepts.
- OpenTelemetry Collector Tail Sampling Processor — policy-based tail sampling and trace grouping by trace ID.
- Grafana Loki Label Best Practices — guidance on labels and high-cardinality risk.
- Grafana Loki Cardinality Documentation — explains log stream cardinality as combinations of label names and values.
- Google SRE Book, Monitoring Distributed Systems — four golden signals: latency, traffic, errors, saturation.
- OWASP Logging Cheat Sheet — secure logging and sensitive data guidance.

---

## 28. Status Seri

Selesai sampai: **Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership**.

Belum selesai.

Berikutnya:

**Part 34 — Building a Production-Grade Java Observability Starter Kit**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./32-observability-in-containers-and-kubernetes.md">⬅️ Part 32 — Observability in Containers and Kubernetes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./34-building-production-grade-java-observability-starter-kit.md">Part 34 — Building a Production-Grade Java Observability Starter Kit ➡️</a>
</div>

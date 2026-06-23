# learn-go-logging-observability-profiling-troubleshooting-part-026.md

# Part 026 — Alerting, SLO, and Error Budget Engineering

> Seri: `learn-go-logging-observability-profiling-troubleshooting`  
> Bagian: `026 / 032`  
> Fokus: SLI, SLO, SLA, error budget, burn rate alerting, actionable alerts, alert fatigue, Go service alert design  
> Target pembaca: Java software engineer / tech lead yang ingin membangun alerting production-grade berbasis user impact, bukan noise

---

## 0. Posisi Bagian Ini dalam Seri

Bagian sebelumnya membahas:

- logging,
- metrics,
- tracing,
- profiling,
- Go runtime observability,
- troubleshooting methodology,
- latency,
- throughput/saturation,
- memory/OOM,
- network/dependency,
- Kubernetes observability.

Semua telemetry itu belum cukup jika tidak menghasilkan keputusan operasional.

Alerting adalah jembatan antara observability dan action.

Tetapi alerting yang buruk menghasilkan:

- pager fatigue,
- alert storm,
- ignored alerts,
- false urgency,
- dashboard archaeology,
- tim tidak percaya monitoring,
- incident terlambat karena alert penting tenggelam,
- engineer dibangunkan untuk symptom yang tidak butuh tindakan.

Bagian ini membahas cara merancang alert berbasis:

```text
user impact
SLO
error budget
burn rate
actionability
operational ownership
```

---

## 1. Core Thesis

**Alert yang baik bukan alert yang memberi tahu bahwa sesuatu berubah. Alert yang baik memberi tahu bahwa user impact atau risk terhadap SLO membutuhkan tindakan manusia sekarang.**

Bad alert:

```text
CPU > 80%
Memory > 75%
Goroutines > 1000
p99 latency > 500ms
```

Mungkin berguna sebagai dashboard panel, tetapi belum tentu layak membangunkan orang.

Good alert:

```text
Checkout API is burning its 99.9% availability error budget at 14x rate over 5 minutes and 6x rate over 1 hour due to elevated 5xx responses. Page on-call.
```

Good alert menjawab:

1. apa yang rusak?
2. siapa terdampak?
3. seberapa parah?
4. apakah butuh tindakan sekarang?
5. kemungkinan area investigasi awal?
6. apa runbook-nya?

---

## 2. Alerting Vocabulary

| Term | Meaning |
|---|---|
| SLI | Service Level Indicator; metric yang mengukur kualitas layanan |
| SLO | Service Level Objective; target kualitas layanan |
| SLA | Service Level Agreement; kontrak formal dengan konsekuensi |
| Error budget | jumlah kegagalan yang masih diizinkan dalam periode SLO |
| Burn rate | seberapa cepat error budget dikonsumsi |
| Page alert | alert yang harus membangunkan/on-call bertindak segera |
| Ticket alert | alert yang perlu ditangani tetapi tidak urgent |
| Symptom alert | alert berdasarkan user-visible failure |
| Cause alert | alert berdasarkan internal cause |
| Saturation alert | alert saat resource mendekati kapasitas |
| Noise | alert yang tidak membutuhkan action |
| Alert fatigue | kondisi ketika orang mulai mengabaikan alert karena terlalu banyak/noisy |

---

## 3. SLI, SLO, SLA

### 3.1 SLI

SLI adalah measurement.

Contoh:

```text
Availability SLI = successful requests / total valid requests
Latency SLI = requests under 300ms / total valid requests
Freshness SLI = data updates completed within 5 minutes / total updates
Correctness SLI = valid responses / total responses
```

### 3.2 SLO

SLO adalah target internal.

Contoh:

```text
99.9% of checkout requests succeed over 30 days.
99% of search requests complete under 500ms over 7 days.
99.5% of jobs complete within 10 minutes over 30 days.
```

### 3.3 SLA

SLA adalah kontrak eksternal.

Contoh:

```text
Customer contract states monthly availability must be >= 99.5%, otherwise service credits apply.
```

Rule:

```text
SLA should usually be looser than SLO.
```

Internal SLO memberi ruang untuk bertindak sebelum melanggar SLA.

---

## 4. Why Error Budget Matters

Jika SLO availability 99.9% dalam 30 hari:

```text
Allowed failure = 0.1%
```

Jika ada 10,000,000 valid requests per 30 hari:

```text
Allowed failed requests = 10,000
```

Itu error budget.

Error budget memberi bahasa bisnis-teknis:

- terlalu banyak incident? kurangi release risk,
- budget sehat? boleh ambil risiko feature,
- budget terbakar cepat? page,
- budget hampir habis? freeze/mitigation,
- budget habis? reliability work prioritas.

Tanpa error budget, debat menjadi subjektif:

```text
"Apakah latency ini cukup buruk?"
"Apakah kita harus rollback?"
"Apakah boleh release?"
```

Dengan error budget:

```text
"Kita burn 20% monthly budget dalam 2 jam. Reliability action lebih prioritas daripada feature rollout."
```

---

## 5. SLO Should Be User-Centric

Bad SLO:

```text
CPU < 80%
Goroutines < 5000
Pod restarts < 1/day
```

These are internal signals, not user outcomes.

Good SLO:

```text
99.9% of valid checkout requests return non-5xx within 1 second over 30 days.
99% of payment confirmation jobs complete within 2 minutes over 7 days.
99.5% of login attempts complete successfully within 800ms over 30 days.
```

Internal metrics support diagnosis, but SLO should represent user-visible reliability.

---

## 6. Choosing Good SLIs

Good SLI properties:

1. user-impact aligned,
2. measurable,
3. reliable,
4. hard to game,
5. attributable enough,
6. low cardinality,
7. available in real time,
8. stable definition,
9. documented exclusions,
10. actionable.

Bad SLI examples:

```text
average latency
CPU usage
raw 500 count without denominator
all requests including health checks
all paths mixed together
errors including client bad requests
```

---

## 7. Request-Based Availability SLI

Example:

```text
availability = good_requests / valid_requests
```

Good request could be:

- HTTP 2xx,
- HTTP 3xx if expected,
- selected 4xx that represent successful domain result if appropriate,
- not 5xx,
- not timeout,
- not panic.

Valid request excludes:

- health probes,
- readiness/liveness,
- client aborted before app receives request maybe,
- invalid auth attempts depending service,
- intentionally rejected rate-limited requests depending SLO definition.

Example PromQL concept:

```promql
sum(rate(http_requests_total{route="/checkout",status_class!~"5xx"}[5m]))
/
sum(rate(http_requests_total{route="/checkout"}[5m]))
```

But exact definition must match your service.

---

## 8. Latency SLI

Latency SLI is often better as threshold ratio than percentile.

Instead of:

```text
p99 < 500ms
```

Use:

```text
99% of valid requests complete under 500ms
```

Prometheus histogram ratio:

```promql
sum(rate(http_request_duration_seconds_bucket{route="/checkout",le="0.5"}[5m]))
/
sum(rate(http_request_duration_seconds_count{route="/checkout"}[5m]))
```

Why threshold ratio?

- aligns with error budget math,
- easier burn rate,
- avoids percentile aggregation pitfalls,
- maps directly to good/bad events.

---

## 9. Job SLI

For async jobs:

Availability-like:

```text
successful_jobs / total_jobs
```

Latency-like:

```text
jobs_completed_under_10m / total_jobs
```

Freshness:

```text
data_age_seconds < threshold
```

Queue SLI:

```text
messages_processed_within_deadline / messages_received
```

Important:

- job success may be delayed,
- retries complicate counting,
- duplicate jobs must be handled,
- dead-letter queue matters,
- backlog age often more useful than queue depth.

---

## 10. Dependency SLO vs App SLO

Your app may depend on external systems.

Separate:

```text
App SLO:
Checkout success from user perspective.

Dependency SLI:
Payment provider charge call success/latency.
```

Do not define app SLO only as dependency SLO.

Your app can:

- retry safely,
- degrade,
- cache,
- fail fast,
- use fallback,
- shed load.

Dependency failure is cause signal, not necessarily final user impact.

---

## 11. Error Budget Math

For availability SLO:

```text
SLO = 99.9%
Allowed bad fraction = 0.1% = 0.001
```

Over 30 days:

```text
budget = 0.001 * total valid events
```

Burn rate:

```text
actual bad rate / allowed bad rate
```

If current bad rate is 1% and allowed bad rate is 0.1%:

```text
burn rate = 1% / 0.1% = 10x
```

Interpretation:

```text
At 10x burn, one day of this incident consumes 10 days worth of error budget.
```

---

## 12. Multi-Window Burn Rate Alerting

Single-window alerting has problems:

- short window: fast but noisy,
- long window: stable but slow.

Multi-window alerting combines both:

```text
fast burn over short window
AND
sustained burn over longer window
```

Example classes:

| Severity | Short Window | Long Window | Meaning |
|---|---:|---:|---|
| page critical | 5m high burn | 1h high burn | severe active incident |
| page warning | 30m burn | 6h burn | sustained user impact |
| ticket | 2h burn | 1d burn | budget consumption trend |
| report | 1d burn | 7d burn | planning/reliability work |

The exact burn thresholds depend on SLO period and response expectations.

---

## 13. Why Burn Rate Alerts Beat Static Thresholds

Static alert:

```text
5xx rate > 1%
```

Problems:

- for 99.9% SLO, 1% is 10x burn,
- for 99% SLO, 1% is exactly budget rate,
- low traffic services may be noisy,
- no relation to budget period,
- not tied to user expectation.

Burn alert:

```text
bad event rate is consuming error budget too quickly
```

It normalizes against reliability target.

---

## 14. Page vs Ticket

Not every alert should page.

### Page when:

- user impact ongoing,
- error budget burning fast,
- immediate human action likely helps,
- automation cannot safely fix,
- delay worsens impact.

### Ticket when:

- trend needs work but not immediate,
- capacity approaching but not urgent,
- low-severity SLO budget burn,
- missing telemetry,
- non-critical dependency degradation,
- cleanup required.

### Dashboard only when:

- useful context,
- no action required,
- exploratory.

Bad page:

```text
CPU high but service healthy and autoscaling working.
```

Good ticket:

```text
Checkout p95 latency SLO consumed 20% weekly budget; investigate payload growth before next release.
```

---

## 15. Symptom Alerts vs Cause Alerts

Symptom alerts are user-impact alerts:

- availability burn,
- latency burn,
- job freshness violation,
- error budget burn.

Cause alerts are diagnostic or predictive:

- CPU throttling high,
- DB pool wait high,
- queue depth high,
- OOM risk,
- disk full soon.

Rule:

```text
Page primarily on symptoms.
Use cause alerts for routing, tickets, or secondary pages only when immediate action is clear.
```

Exception:

- cause will imminently create severe outage,
- cause has clear action,
- user impact is hard to measure fast enough.

Example:

```text
Kafka consumer lag age > 30m for payment-confirmation topic
```

This may be symptom for async system.

---

## 16. Actionability Test

Every alert should pass:

```text
Can the on-call take a specific action after receiving this alert?
```

If not, do not page.

Action examples:

- rollback,
- scale,
- open circuit breaker,
- disable feature flag,
- drain queue,
- restart stuck pod after profile,
- increase limit with known runbook,
- contact dependency owner,
- fail over,
- shed load,
- pause batch job.

Non-actionable:

- "something changed",
- "metric above arbitrary threshold",
- "debug endpoint unreachable for one scrape",
- "pod restarted once but service healthy",
- "p99 high for 3 requests on low traffic endpoint".

---

## 17. Alert Message Design

Good alert includes:

```text
service
environment
SLO/SLI
severity
start time
current value
threshold
affected route/job/dependency
burn rate
version if relevant
runbook link
dashboard link
initial triage hints
```

Bad:

```text
ALERT: HighLatency
```

Better:

```text
Checkout latency SLO burn: 18x over 5m and 7x over 1h.
Service: checkout-api prod
Route: POST /checkout
Good events: duration <= 1s and status < 500
Current good ratio: 98.2%
SLO target: 99.9%
Runbook: ...
```

---

## 18. Alert Labels and Routing

Alert labels should support routing:

```text
service
team
environment
severity
slo
route/group
dependency
region/zone
```

Avoid high-cardinality labels:

```text
pod
request_id
user_id
raw_path
error_message
```

Pod-level labels can be useful for diagnostic alerts but dangerous for paging fan-out.

Route to team owning the service and SLO.

---

## 19. Alert Fatigue

Alert fatigue happens when:

- too many alerts,
- low actionability,
- duplicate alerts,
- flapping,
- false positives,
- alerts during expected maintenance,
- every cause metric pages,
- no runbook,
- no ownership,
- pages are not reviewed.

Symptoms:

- people ignore pages,
- alert channels muted,
- incidents found by users,
- on-call burnout,
- repeated noisy alerts.

Fix:

- delete bad alerts,
- convert page to ticket,
- add inhibit rules,
- group alerts,
- page on SLO burn,
- create runbooks,
- review every page,
- tune thresholds,
- reduce flapping.

---

## 20. Alert Review Discipline

Every page should be reviewed.

Ask:

```text
[ ] Was this alert actionable?
[ ] Did it detect real user impact?
[ ] Did it fire fast enough?
[ ] Did it fire too often?
[ ] Was severity correct?
[ ] Was runbook useful?
[ ] Were there duplicate alerts?
[ ] Did it route to right team?
[ ] Should it be page, ticket, or dashboard only?
[ ] What telemetry was missing?
```

Alert quality is part of system reliability.

---

## 21. SLO for Go HTTP API

Example SLO:

```text
Service: orders-api
Window: 30 days

Availability:
99.9% of valid HTTP requests to public API routes return non-5xx.

Latency:
99% of valid HTTP requests to public API routes complete within 500ms.
```

SLI event filters:

- exclude `/livez`, `/readyz`, `/metrics`, `/debug`,
- group by route template,
- exclude client 4xx from availability bad events,
- include server timeouts as bad,
- include context deadline due to server-side dependency as bad,
- count only completed requests plus known timeouts.

---

## 22. SLO for Background Worker

Example:

```text
Service: invoice-worker
Window: 7 days

Freshness:
99.5% of invoices are generated within 10 minutes of invoice_requested event.

Correctness:
99.9% of invoice generation jobs complete successfully without manual intervention.
```

Metrics needed:

- event received timestamp,
- job completed timestamp,
- job failed timestamp,
- dead-letter count,
- retry count,
- oldest unprocessed age,
- queue lag.

For async systems, queue depth alone is weak.

Age/freshness is usually stronger.

---

## 23. SLO for Dependency Client

Example:

```text
Payment provider client:
99% of charge attempts receive final response within 800ms excluding provider 4xx business rejections.
```

But keep dependency client SLO separate from user-facing checkout SLO.

Dependency client SLO helps:

- provider accountability,
- circuit breaker tuning,
- timeout budget,
- retry policy,
- vendor escalation.

---

## 24. Go Metrics Needed for SLO Alerting

HTTP server metrics:

```text
http_server_requests_total{route,method,status_class}
http_server_request_duration_seconds_bucket{route,method,status_class}
http_server_inflight_requests
```

Dependency metrics:

```text
dependency_requests_total{dependency,operation,status_class,error_class}
dependency_request_duration_seconds_bucket{dependency,operation}
dependency_retries_total{dependency,operation}
dependency_timeouts_total{dependency,operation,phase}
```

Worker metrics:

```text
jobs_total{job_type,status}
job_duration_seconds_bucket{job_type}
job_freshness_seconds_bucket{job_type}
queue_oldest_age_seconds{queue}
```

Saturation support:

```text
queue_depth
db_pool_wait_duration_seconds
goroutines
cpu_throttling
heap_live
gc_cpu
```

---

## 25. Prometheus Histogram SLO Pattern

For latency threshold SLI:

```promql
good =
sum(rate(http_server_request_duration_seconds_bucket{route="/checkout",le="1"}[5m]))

total =
sum(rate(http_server_request_duration_seconds_count{route="/checkout"}[5m]))

good_ratio = good / total
bad_ratio = 1 - good_ratio
```

For availability:

```promql
bad =
sum(rate(http_server_requests_total{route="/checkout",status_class=~"5xx"}[5m]))

total =
sum(rate(http_server_requests_total{route="/checkout"}[5m]))

bad_ratio = bad / total
```

In real systems, filter valid traffic carefully.

---

## 26. Low Traffic Alerting

Low traffic services make ratio alerts noisy.

If total requests are tiny:

```text
1 failed request can look like 100% failure.
```

Approaches:

1. minimum traffic threshold,
2. longer windows,
3. combine count and ratio,
4. synthetic probes,
5. heartbeat/freshness SLO,
6. ticket instead of page for low-volume ratios,
7. service-specific SLO.

Example condition:

```text
bad_ratio high AND total_requests > N
```

But be careful: low-volume critical service may still require immediate action.

---

## 27. High Traffic Alerting

High traffic services can burn budget very fast.

Need:

- short-window burn alert,
- fast page,
- route/region/version breakdown,
- canary detection,
- automated rollback maybe,
- strong dashboards.

High traffic also makes percentiles and ratios statistically stable.

---

## 28. Alerting for Latency

Avoid raw p99 alert alone when possible.

Better:

```text
Latency bad event ratio:
requests slower than threshold / total requests
```

Example:

```text
SLO: 99% under 500ms
Bad event: request duration > 500ms
Allowed bad fraction: 1%
Burn rate: current_bad_fraction / 1%
```

Still keep percentile dashboards for diagnosis.

---

## 29. Alerting for Error Rate

Availability bad events:

- 5xx,
- panics,
- server-side timeouts,
- dependency failure causing user failure.

Be careful with:

- 4xx client errors,
- auth failures,
- rate limits,
- intentional load shedding,
- validation errors.

Depending on product expectation, 429/503 from load shedding may count as bad for user-facing SLO.

Document clearly.

---

## 30. Alerting for Saturation

Saturation alerts can be pages if imminent impact.

Examples:

### Page

```text
queue_oldest_age_seconds > freshness SLO threshold
```

For async worker, this is user impact.

```text
container memory > 98% limit and increasing, OOM likely in <10m
```

if immediate action exists.

### Ticket

```text
DB pool wait p95 elevated for 2h but SLO still healthy
```

### Dashboard

```text
CPU 70%
```

unless tied to SLO impact.

---

## 31. Alert Inhibition and Grouping

During incident, many alerts fire.

Use inhibition/grouping:

- if service SLO page fires, suppress pod-level noise,
- group by service/environment,
- do not page once per pod,
- dependency outage should not page every consumer team if central dependency team is owner, unless user impact requires app action,
- silence during planned maintenance with explicit time bounds.

Bad:

```text
100 pods each send HighCPU page.
```

Better:

```text
Service-level CPU saturation alert with affected pod count in annotation.
```

---

## 32. Alert Runbooks

Every page alert should link to runbook.

Runbook should include:

1. alert meaning,
2. likely causes,
3. first dashboards,
4. first commands,
5. profiles to capture,
6. mitigation options,
7. escalation path,
8. rollback instructions,
9. how to verify recovery,
10. post-incident tasks.

Runbook must be tested and updated.

A stale runbook is dangerous.

---

## 33. Example Alert: Checkout Availability Burn

Conceptual Prometheus rule:

```yaml
groups:
- name: checkout-slo
  rules:
  - alert: CheckoutAvailabilityFastBurn
    expr: |
      (
        sum(rate(http_server_requests_total{
          service="checkout-api",
          route="/checkout",
          status_class=~"5xx"
        }[5m]))
        /
        sum(rate(http_server_requests_total{
          service="checkout-api",
          route="/checkout"
        }[5m]))
      ) > (14 * 0.001)
      and
      (
        sum(rate(http_server_requests_total{
          service="checkout-api",
          route="/checkout",
          status_class=~"5xx"
        }[1h]))
        /
        sum(rate(http_server_requests_total{
          service="checkout-api",
          route="/checkout"
        }[1h]))
      ) > (6 * 0.001)
    for: 2m
    labels:
      severity: page
      service: checkout-api
      slo: checkout-availability
    annotations:
      summary: "Checkout availability SLO fast burn"
      runbook: "https://runbooks.example.com/checkout/availability"
```

Numbers are examples. Your thresholds must match your SLO and operational policy.

---

## 34. Example Alert: Worker Freshness

```yaml
- alert: InvoiceWorkerFreshnessSLOBurn
  expr: |
    queue_oldest_age_seconds{service="invoice-worker",queue="invoice"} > 600
  for: 5m
  labels:
    severity: page
    service: invoice-worker
    slo: invoice-freshness
  annotations:
    summary: "Invoice queue oldest message age exceeds 10m freshness objective"
    runbook: "https://runbooks.example.com/invoice/freshness"
```

For worker systems, freshness/oldest age often maps better to user impact than queue depth.

---

## 35. Example Alert: Memory OOM Risk

This is a cause/risk alert.

```yaml
- alert: GoServiceMemoryOOMRisk
  expr: |
    container_memory_working_set_bytes{container="api"}
    /
    container_spec_memory_limit_bytes{container="api"}
    > 0.95
  for: 10m
  labels:
    severity: ticket
    service: api
  annotations:
    summary: "Container memory above 95% of limit"
    runbook: "https://runbooks.example.com/go/memory-oom"
```

May be page if:

- critical service,
- trend predicts imminent OOM,
- no autoscaling/mitigation,
- previous OOM incidents.

Better alert includes trend and heap correlation if possible.

---

## 36. Example Alert: DB Pool Wait

```yaml
- alert: DBPoolWaitHigh
  expr: |
    histogram_quantile(
      0.95,
      sum(rate(db_pool_wait_duration_seconds_bucket{service="orders-api"}[5m])) by (le)
    ) > 0.1
  for: 10m
  labels:
    severity: ticket
    service: orders-api
  annotations:
    summary: "DB pool wait p95 above 100ms"
```

This is usually a cause alert.

Page only if it correlates with SLO burn or worker freshness.

---

## 37. Alert Design for Go Runtime Metrics

Runtime metric alerts should usually be supportive.

### Goroutine Count

Bad:

```text
goroutines > 1000
```

Better:

```text
goroutines increasing monotonically 5x baseline over 30m AND memory/latency impact
```

### GC CPU

Bad:

```text
GC cycles > N
```

Better:

```text
GC CPU high AND latency SLO burn OR allocation rate 5x after deploy
```

### Heap Live

Bad:

```text
heap_live > 1GiB
```

Better:

```text
heap_live increasing for 1h and container memory > 85% limit
```

### CPU Throttling

Good if correlated:

```text
CPU throttling > 20% and latency SLO burn
```

---

## 38. Alert Testing

Test alerts like code.

Methods:

1. unit test PromQL with sample data if tooling available,
2. replay metrics in staging,
3. trigger synthetic failure,
4. chaos test dependency failure,
5. run load test to verify saturation alerts,
6. alert review after incident.

Questions:

```text
[ ] Did it fire?
[ ] Did it fire too early/late?
[ ] Did it route correctly?
[ ] Was message useful?
[ ] Did runbook work?
[ ] Were duplicates suppressed?
```

---

## 39. SLO Review Cadence

SLOs should be reviewed.

Review:

- monthly or quarterly,
- after major incident,
- after product change,
- after traffic mix change,
- after architecture change.

Ask:

```text
[ ] Does SLO still represent user expectation?
[ ] Is target too strict or too loose?
[ ] Are SLIs accurate?
[ ] Are exclusions documented?
[ ] Are alerts actionable?
[ ] Did error budget policy influence decisions?
[ ] Did teams ignore budget?
```

---

## 40. Error Budget Policy

Example policy:

```text
If 30-day error budget remaining > 50%:
  normal release cadence.

If remaining 20-50%:
  increased caution; reliability review for risky releases.

If remaining < 20%:
  freeze non-critical risky releases; prioritize reliability work.

If budget exhausted:
  incident review; reliability work required before feature release.
```

Policy must fit organization.

Without policy, error budget is just a graph.

---

## 41. SLO Anti-Patterns

### 41.1 Too Many SLOs

If every metric is an SLO, none matter.

### 41.2 Unrealistic SLO

99.999% for a service with weak dependencies and small team may create permanent failure.

### 41.3 SLO Based on Internals

CPU/memory/goroutine are not user SLOs.

### 41.4 No Error Budget Policy

SLO has no decision impact.

### 41.5 No Exclusions

Health checks, client errors, invalid traffic pollute SLI.

### 41.6 Average Latency SLO

Average hides tail.

### 41.7 Per-Pod SLO Paging

Users care about service, not individual pod, except diagnostic routing.

### 41.8 Alert Without Runbook

Pager becomes guessing game.

---

## 42. Incident Case Study 1: Good SLO Alert

### Symptom

Checkout availability SLO fast burn fires.

Alert:

```text
14x burn over 5m and 7x over 1h
route=/checkout
status_class=5xx
version=v2 only
```

Evidence:

- canary v2 error rate high,
- v1 healthy,
- logs show panic in payment mapping.

Action:

- rollback v2.
- SLO burn stops.

Outcome:

- alert detected real user impact,
- routed correctly,
- mitigation obvious,
- runbook worked.

---

## 43. Incident Case Study 2: Bad CPU Alert

Alert:

```text
CPU > 80% on pod X
```

Reality:

- service SLO healthy,
- HPA scaled,
- no user impact,
- alert fired repeatedly during normal peak.

Fix:

- remove page,
- keep CPU dashboard,
- create ticket alert for sustained CPU near capacity,
- page only on SLO burn or CPU saturation causing latency.

---

## 44. Incident Case Study 3: Missing Freshness SLO

Symptom:

- invoice jobs delayed 4 hours.
- API request SLO healthy.
- no page fired.

Why:

- only API latency/error alerts existed.
- worker queue depth alert threshold too high.
- no oldest message age/freshness SLO.

Fix:

- add job freshness SLO,
- alert on oldest age,
- add worker runbook,
- add dependency lag dashboard.

---

## 45. Incident Case Study 4: Alert Storm

Dependency outage causes:

- 20 services page,
- every pod sends HTTPDependencyHighError,
- central dependency team also paged,
- on-call channels flooded.

Fix:

- group alerts by service/dependency,
- inhibit pod-level alerts when service SLO alert active,
- central dependency status alert routes to dependency owner,
- app teams page only if user SLO burn requires app action,
- add circuit breaker dashboards.

---

## 46. Building Alert Culture

Technical config is not enough.

Healthy alert culture:

1. every page is reviewed,
2. noisy alerts are deleted or downgraded,
3. runbooks are maintained,
4. ownership is clear,
5. SLO budget influences roadmap,
6. reliability work is planned,
7. alert changes are code-reviewed,
8. dashboards support runbooks,
9. incidents improve telemetry,
10. on-call health matters.

Alerting is part of engineering product quality.

---

## 47. Checklist: Alert Readiness

```text
[ ] Alert is tied to user impact or imminent risk.
[ ] Severity is correct.
[ ] Alert has clear owner.
[ ] Alert has runbook.
[ ] Alert message includes service/environment/SLO.
[ ] Threshold is justified.
[ ] Window avoids flapping.
[ ] Low traffic behavior handled.
[ ] High cardinality labels avoided.
[ ] Duplicate alerts grouped/inhibited.
[ ] Action is known.
[ ] Alert tested.
[ ] Review process exists.
```

---

## 48. Checklist: SLO Readiness

```text
[ ] User journey identified.
[ ] SLI precisely defined.
[ ] Good/bad events defined.
[ ] Exclusions documented.
[ ] Target selected intentionally.
[ ] Window selected.
[ ] Error budget calculated.
[ ] Burn alerts designed.
[ ] Dashboard exists.
[ ] Runbook exists.
[ ] Error budget policy exists.
[ ] Ownership defined.
[ ] Review cadence defined.
```

---

## 49. Exercises

### Exercise 1 — Define SLO for Go API

For endpoint:

```text
POST /orders
```

Define:

1. availability SLI,
2. latency SLI,
3. exclusions,
4. target,
5. window,
6. page alert,
7. ticket alert.

### Exercise 2 — Worker Freshness SLO

For background job:

```text
send invoice email after payment
```

Define:

1. freshness SLI,
2. success SLI,
3. metrics required,
4. alert condition,
5. runbook first steps.

### Exercise 3 — Convert Bad Alerts

Convert these into better alerts:

```text
CPU > 80%
Memory > 75%
Goroutines > 5000
p99 > 1s
Queue depth > 1000
```

Make each either:

- SLO page,
- ticket,
- dashboard panel,
- delete.

### Exercise 4 — Burn Rate Math

Given:

```text
SLO = 99.9%
Current 5xx ratio = 2%
```

Compute burn rate.

Explain operational meaning.

### Exercise 5 — Alert Review

Take an incident from previous parts.

Write:

1. what alert should have fired,
2. what supporting alerts should exist,
3. which alerts should not page,
4. runbook link contents.

---

## 50. What Good Looks Like

Anda memahami alerting/SLO/error budget engineering secara production-grade jika mampu:

1. mendefinisikan user-centric SLI,
2. memilih SLO target realistis,
3. menghitung error budget,
4. mendesain burn-rate page alert,
5. membedakan page/ticket/dashboard,
6. menghindari alert fatigue,
7. menulis alert message yang actionable,
8. menghubungkan Go runtime alerts dengan SLO impact,
9. membuat runbook yang berguna,
10. menggunakan error budget untuk keputusan engineering.

---

## 51. Summary

Observability bukan hanya melihat sistem.

Observability yang matang harus menghasilkan keputusan:

```text
Apakah user terdampak?
Apakah SLO terancam?
Apakah on-call harus bangun?
Apa aksi pertama?
Apakah release harus dihentikan?
Apakah reliability work harus diprioritaskan?
```

SLI mengukur.

SLO menentukan target.

Error budget memberi ruang risiko.

Burn rate memberi urgensi.

Alert menghubungkan semua itu ke action manusia.

Untuk Go services, internal metrics seperti goroutines, GC, heap, CPU throttling, queue depth, dan DB pool wait sangat penting, tetapi biasanya sebagai diagnostic/cause signals.

Page sebaiknya terutama berdasarkan symptom dan SLO burn.

---

## 52. Status Seri

Bagian ini adalah:

```text
learn-go-logging-observability-profiling-troubleshooting-part-026.md
```

Status:

```text
Part 026 dari 032
Seri belum selesai
```

Bagian berikutnya:

```text
learn-go-logging-observability-profiling-troubleshooting-part-027.md
```

Topik berikutnya:

```text
Dashboard Design for Go Services
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-025.md">⬅️ Part 025 — Kubernetes Observability for Go Services</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-027.md">Part 027 — Dashboard Design for Go Services ➡️</a>
</div>
